// One shopper, one visit. Each step: perceive the page, ask the AI what this person does next,
// do only that, write it down. The visit ends when they buy, give up or run out of steps.

import { mkdirSync, renameSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { askJson, SHOPPER_MODEL, type Part } from './ai.js';
import { openSession, settle } from './browser.js';
import { perceive, type Observation } from './perceive.js';
import type { Mode, Shopper } from './shoppers.js';

export const ACTIONS: Record<Mode, string[]> = {
  mouse: ['click', 'click_text', 'type', 'select', 'scroll_down', 'scroll_up', 'back', 'wait', 'give_up', 'done'],
  zoom: ['click', 'click_text', 'type', 'select', 'scroll_down', 'scroll_up', 'back', 'wait', 'give_up', 'done'],
  slowphone: ['click', 'click_text', 'type', 'select', 'scroll_down', 'scroll_up', 'back', 'wait', 'give_up', 'done'],
  keyboard: ['press', 'type', 'wait', 'give_up', 'done'],
  screenreader: ['activate', 'type', 'select', 'press', 'wait', 'give_up', 'done'],
};

export const KEYS = ['Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape'];

export interface Decision {
  thought: string;
  say: string;
  action: string;
  target: string;
  text: string;
  times: number;
}

export function decisionSchema(mode: Mode) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['thought', 'say', 'action', 'target', 'text', 'times'],
    properties: {
      thought: { type: 'string', description: 'What you notice on this screen and why you pick this action. First person, short.' },
      say: { type: 'string', description: 'One short sentence you would say out loud right now.' },
      action: { type: 'string', enum: ACTIONS[mode] },
      target: { type: 'string', description: 'The number of the box, or the screen reader ref like e12. Empty if not needed.' },
      text: { type: 'string', description: 'Text to type, option to select, or the key to press. For give_up: the reason.' },
      times: { type: 'integer', description: 'How many times to press the key, 1 to 15. 1 for other actions.' },
    },
  };
}

const HOW: Record<Mode, string> = {
  mouse:
    'You get a screenshot. Things that look clickable have numbered orange boxes, listed below it. ' +
    'click a number, type text into a number, select an option in a number, scroll, go back or wait. To click words ' +
    'you can see that have no box, use click_text with those exact words.',
  zoom:
    'You get a screenshot of the zoomed window. Things that look clickable have numbered orange boxes, listed below it. ' +
    'click a number, type text into a number, select an option in a number, scroll, go back or wait. To click words ' +
    'you can see that have no box, use click_text with those exact words.',
  slowphone:
    'You get a screenshot of your phone. Things that look tappable have numbered orange boxes, listed below it. ' +
    'click (tap) a number, type text into a number, select an option in a number, scroll, go back or wait for loading. ' +
    'To tap words you can see that have no box, use click_text with those exact words.',
  keyboard:
    'You get a plain screenshot. You cannot click. press a key (Tab, Shift+Tab, Enter, Space, arrows, Escape) one or more ' +
    'times, or type text into whatever is focused. Look for the focus outline to know where you are. Pressing Tab many ' +
    'times in one go is fine when you know how far you need to go.',
  screenreader:
    'You get what the screen reader reads, with refs like [ref=e12]. activate a ref (like pressing Enter on it), type ' +
    'text into a ref, select an option in a ref, or press keys. You cannot see images or layout, only what is read out.',
};

export function systemPrompt(s: Shopper): string {
  return [
    `You are ${s.name}. ${s.about}`,
    'You are on an online shop that sells telescopes and astronomy gear. You want to buy one product, any one you like, ' +
      'and finish the checkout. The checkout form is filled in with someone else\'s sample details. Change the email ' +
      `address to yours, ${s.id}@example.com, so the receipt reaches you, and keep everything else as it is.`,
    'Act exactly like this person would, with only the abilities described. If something does not work for you, try ' +
      'another way or two like a real person would. If you are really stuck, choose give_up and say why in text.',
    'Choose done only when the shop clearly says your order is complete.',
    HOW[s.mode],
    'Reply with one next action only.',
  ].join('\n\n');
}

export interface StepRecord {
  step: number;
  url: string;
  title: string;
  thought: string;
  say: string;
  action: string;
  target: string;
  targetLabel: string;
  text: string;
  times: number;
  result: string;
  screenshot: string;
  heard?: string;
  at: string;
}

export type OutcomeKind = 'bought' | 'gave_up' | 'step_limit' | 'error';

export interface Outcome {
  shopper: string;
  name: string;
  mode: Mode;
  outcome: OutcomeKind;
  steps: number;
  lastUrl: string;
  reason: string;
  lastSay: string;
  orderId?: string;
}

export function orderIdFromUrl(url: string): string | undefined {
  const m = /\/cart\/checkout\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function act(page: Page, mode: Mode, d: Decision, obs: Observation): Promise<{ result: string; label: string }> {
  const times = Math.max(1, Math.min(15, d.times || 1));
  const mark = obs.marks.find((m) => String(m.n) === d.target.trim());
  const label = mark?.label ?? d.target;
  const byMark = () => page.locator(`[data-lti-n="${d.target.trim()}"]`).first();
  const byRef = () => page.locator(`aria-ref=${d.target.trim()}`);
  switch (d.action) {
    case 'click':
      if (!mark) return { result: `there is no box ${d.target}`, label };
      if (mode === 'slowphone') await byMark().tap({ timeout: 6000 });
      else await byMark().click({ timeout: 5000 });
      return { result: 'clicked', label };
    case 'click_text': {
      const exact = page.getByText(d.text, { exact: true }).filter({ visible: true });
      const loc = (await exact.count()) ? exact.first() : page.getByText(d.text).filter({ visible: true }).first();
      if (mode === 'slowphone') await loc.tap({ timeout: 6000 });
      else await loc.click({ timeout: 5000 });
      return { result: 'clicked', label: `text "${d.text}"` };
    }
    case 'type':
      if (mode === 'keyboard') {
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type(d.text, { delay: 20 });
        return { result: 'typed into the focused element', label: 'focused element' };
      }
      if (mode === 'screenreader') {
        await byRef().fill(d.text, { timeout: 5000 });
        return { result: 'typed', label };
      }
      if (!mark) return { result: `there is no box ${d.target}`, label };
      await byMark().fill(d.text, { timeout: 5000 });
      return { result: 'typed', label };
    case 'select': {
      const loc = mode === 'screenreader' ? byRef() : byMark();
      await loc.selectOption({ label: d.text }, { timeout: 5000 }).catch(() => loc.selectOption(d.text, { timeout: 5000 }));
      return { result: `selected ${d.text}`, label };
    }
    case 'activate':
      await byRef().click({ timeout: 5000 });
      return { result: 'activated', label };
    case 'press': {
      if (!KEYS.includes(d.text)) return { result: `${d.text} is not a key you can use`, label: d.text };
      for (let i = 0; i < times; i++) await page.keyboard.press(d.text, { delay: 30 });
      return { result: `pressed ${d.text} ${times} time(s)`, label: d.text };
    }
    case 'scroll_down':
    case 'scroll_up': {
      const h = page.viewportSize()?.height ?? 600;
      await page.mouse.wheel(0, (d.action === 'scroll_down' ? 1 : -1) * h * 0.8);
      return { result: 'scrolled', label: '' };
    }
    case 'back':
      await page.goBack({ timeout: 8000 }).catch(() => {});
      return { result: 'went back', label: '' };
    case 'wait':
      await page.waitForTimeout(3000);
      return { result: 'waited 3 seconds', label: '' };
    default:
      return { result: `unknown action ${d.action}`, label };
  }
}

export interface WalkOptions {
  shopUrl: string;
  round: string;
  outDir: string;
}

export async function walk(s: Shopper, o: WalkOptions): Promise<Outcome> {
  const dir = join(o.outDir, s.id);
  mkdirSync(dir, { recursive: true });
  const stepsFile = join(dir, 'steps.jsonl');
  writeFileSync(stepsFile, '');
  const patience = s.mode === 'slowphone' ? 10000 : 6000;
  const session = await openSession(s.mode, join(dir, 'video'));
  const { page } = session;
  const history: string[] = [];
  let outcome: Outcome = {
    shopper: s.id,
    name: s.name,
    mode: s.mode,
    outcome: 'step_limit',
    steps: 0,
    lastUrl: o.shopUrl,
    reason: `still trying after ${s.maxSteps} steps`,
    lastSay: '',
  };
  try {
    await page.goto(o.shopUrl, { timeout: 60000 }).catch(() => {});
    await settle(page, patience);
    for (let step = 1; step <= s.maxSteps; step++) {
      const obs = await perceive(page, s.mode);
      const shot = `step-${String(step).padStart(2, '0')}.jpg`;
      writeFileSync(join(dir, shot), obs.screenshot);
      const user: Part[] = [];
      if (obs.imageForModel) {
        user.push({ type: 'input_image', image_url: `data:image/jpeg;base64,${obs.imageForModel.toString('base64')}`, detail: 'high' });
      }
      user.push({
        type: 'input_text',
        text:
          (history.length ? `What you did so far:\n${history.slice(-8).join('\n')}\n\n` : '') +
          `Step ${step} of at most ${s.maxSteps}.\n${obs.text}`,
      });
      const d = await askJson<Decision>({
        model: SHOPPER_MODEL,
        system: systemPrompt(s),
        user,
        schemaName: 'next_action',
        schema: decisionSchema(s.mode),
        purpose: 'shopper step',
        round: o.round,
        shopper: s.id,
      });
      let result = '';
      let label = '';
      if (d.action === 'give_up' || d.action === 'done') {
        result = d.action;
      } else {
        try {
          ({ result, label } = await act(page, s.mode, d, obs));
        } catch (e) {
          result = `did not work: ${String((e as Error).message).split('\n')[0].slice(0, 160)}`;
        }
        await settle(page, patience);
      }
      const rec: StepRecord = {
        step,
        url: obs.url,
        title: obs.title,
        thought: d.thought,
        say: d.say,
        action: d.action,
        target: d.target,
        targetLabel: label,
        text: d.text,
        times: d.times,
        result,
        screenshot: shot,
        heard: s.mode === 'screenreader' ? obs.text.slice(0, 6000) : undefined,
        at: new Date().toISOString(),
      };
      appendFileSync(stepsFile, JSON.stringify(rec) + '\n');
      history.push(`${step}. ${d.action} ${label || d.target} ${d.text} -> ${result}`.replace(/\s+/g, ' '));
      outcome.steps = step;
      outcome.lastUrl = page.url();
      outcome.lastSay = d.say;
      const orderId = orderIdFromUrl(page.url());
      if (orderId) {
        outcome = { ...outcome, outcome: 'bought', reason: 'order complete', orderId };
        // one last look at the confirmation page for the record
        writeFileSync(join(dir, 'final.jpg'), await page.screenshot({ type: 'jpeg', quality: 70 }));
        break;
      }
      if (d.action === 'done') {
        // They think they are done but the shop never confirmed an order. Tell them and keep going.
        history.push(`${step}. (the shop has not confirmed any order yet)`);
        continue;
      }
      if (d.action === 'give_up') {
        outcome = { ...outcome, outcome: 'gave_up', reason: d.text || d.say };
        break;
      }
    }
  } catch (e) {
    outcome = { ...outcome, outcome: 'error', reason: String((e as Error).message).slice(0, 300) };
  } finally {
    await page.waitForTimeout(800).catch(() => {});
    await session.context.close();
    await session.browser.close();
    const vids = readdirSync(join(dir, 'video')).filter((f) => f.endsWith('.webm'));
    if (vids[0]) renameSync(join(dir, 'video', vids[0]), join(dir, 'video.webm'));
  }
  writeFileSync(join(dir, 'outcome.json'), JSON.stringify(outcome, null, 2) + '\n');
  return outcome;
}
