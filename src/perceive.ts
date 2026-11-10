// What each shopper gets to perceive at one step. Sighted mouse users get a screenshot with numbered
// boxes on the things they could click. Joel gets the plain screenshot, so he has to find the focus
// himself. Maya gets only what a screen reader would read out.

import type { Page } from 'playwright';
import type { Mode } from './shoppers.js';

export interface Mark {
  n: number;
  label: string;
}

export interface Observation {
  url: string;
  title: string;
  screenshot: Buffer; // what is on the screen, kept for the record and the replay
  imageForModel?: Buffer; // what the shopper is shown, when they can see
  text: string; // the text part of what they perceive
  marks: Mark[];
}

const MARK_SCRIPT = () => {
  document.querySelectorAll('[data-lti-overlay]').forEach((e) => e.remove());
  document.querySelectorAll('[data-lti-n]').forEach((e) => e.removeAttribute('data-lti-n'));
  const sel =
    'a, button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [tabindex], [onclick]';
  const seen = new Set<Element>();
  const found: Element[] = [];
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (visible(el)) {
      found.push(el);
      seen.add(el);
    }
  }
  // A sighted mouse user also sees things that look clickable (pointer cursor) even with no markup for it.
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (seen.has(el) || !visible(el)) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    // cursor is inherited, so only the outermost pointer element counts, and nothing inside a marked one
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
    let p: Element | null = el.parentElement;
    let inside = false;
    for (; p; p = p.parentElement) if (seen.has(p)) inside = true;
    if (inside) continue;
    found.push(el);
    seen.add(el);
  }
  const marks: { n: number; label: string }[] = [];
  const layer = document.createElement('div');
  layer.setAttribute('data-lti-overlay', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  found.slice(0, 80).forEach((el, i) => {
    const n = i + 1;
    el.setAttribute('data-lti-n', String(n));
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:2px solid #d9480f;`;
    const tag = document.createElement('div');
    tag.textContent = String(n);
    tag.style.cssText = `position:fixed;left:${Math.max(0, r.left - 2)}px;top:${Math.max(0, r.top - 14)}px;background:#d9480f;color:#fff;font:bold 11px sans-serif;padding:0 3px;`;
    layer.append(box, tag);
    const h = el as HTMLElement;
    const img = el.querySelector('img');
    const sel = el as HTMLSelectElement;
    const raw =
      (el.tagName === 'SELECT' ? `dropdown, showing ${sel.selectedOptions[0]?.text ?? ''}` : '') ||
      el.getAttribute('aria-label') ||
      (h.innerText || '').trim() ||
      (el as HTMLInputElement).placeholder ||
      (el as HTMLInputElement).value ||
      img?.getAttribute('alt') ||
      el.getAttribute('title') ||
      '';
    const kind = el.tagName.toLowerCase() + ((el as HTMLInputElement).type ? `[${(el as HTMLInputElement).type}]` : '');
    marks.push({ n, label: `${kind} "${raw.replace(/\s+/g, ' ').slice(0, 60)}"` });
  });
  document.body.append(layer);
  return marks;
};

export async function perceive(page: Page, mode: Mode): Promise<Observation> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  if (mode === 'screenreader') {
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });
    let tree = await page.ariaSnapshot({ mode: 'ai' }).catch((e) => `(screen reader could not read the page: ${e})`);
    if (tree.length > 14000) tree = tree.slice(0, 14000) + '\n... (more below)';
    const focus = await page
      .evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'nothing (top of page)';
        const name = el.getAttribute('aria-label') || el.innerText?.trim().slice(0, 60) || '';
        return `${el.tagName.toLowerCase()} ${JSON.stringify(name)}`;
      })
      .catch(() => 'unknown');
    return {
      url,
      title,
      screenshot,
      text: `Page title: ${title}\nFocus is on: ${focus}\nThe screen reader reads this page as:\n${tree}`,
      marks: [],
    };
  }
  if (mode === 'keyboard') {
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });
    return { url, title, screenshot, imageForModel: screenshot, text: `Page title: ${title}`, marks: [] };
  }
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 });
  // tsx names inner functions with a __name helper that does not exist in the page
  await page.evaluate('window.__name = window.__name || ((f) => f)').catch(() => {});
  const marks = (await page.evaluate(MARK_SCRIPT).catch((e) => { console.error('marks failed', String(e).slice(0, 300)); return []; })) as Mark[];
  const imageForModel = await page.screenshot({ type: 'jpeg', quality: 70 });
  await page.evaluate(() => document.querySelectorAll('[data-lti-overlay]').forEach((e) => e.remove())).catch(() => {});
  const list = marks.map((m) => `[${m.n}] ${m.label}`).join('\n');
  return {
    url,
    title,
    screenshot,
    imageForModel,
    text: `Page title: ${title}\nThings you can see that look clickable, numbered on the screenshot:\n${list || '(none)'}`,
    marks,
  };
}
