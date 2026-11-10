// Builds the demo video from the dashboard itself. A real browser plays back the recorded series in
// runs/series-b on the dashboard while this script pauses, scrolls and picks what to show. Captions are
// burned in and also written as an .srt file. No model calls.
// Needs the dashboard running: npm run dashboard
// Usage: tsx scripts/dashboard-video.ts <out.mp4> [dashboard url]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

const out = resolve(process.argv[2] ?? 'video/let-them-in-dashboard.mp4');
const base = process.argv[3] ?? 'http://127.0.0.1:8077';
const W = 1920;
const H = 1080;
const tmp = join(dirname(out), '.dashboard-video');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

// Times in the recorded series, from runs/series-b (round.json, steps.jsonl, spend/openai.jsonl, fix.json)
const T = {
  round1: '2026-11-10T03:38:25.203Z',
  joelOut1: '2026-11-10T03:41:20.000Z',
  fix1Writing: '2026-11-10T03:41:25.000Z',
  fix1Built: '2026-11-10T03:43:00.000Z', // AI answered 03:41:49.967, build took 69 s
  round2: '2026-11-10T03:43:05.068Z',
  joelOut2: '2026-11-10T03:46:06.000Z',
  fix2Built: '2026-11-10T03:49:40.000Z', // AI answered 03:48:42.405, build took 56 s
  round3: '2026-11-10T03:49:44.923Z',
  end: '2026-11-10T03:51:50.000Z',
};

type Cap = { from: number; to: number; text: string };
const caps: Cap[] = [];
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;
async function caption(p: Page, text: string, seconds: number) {
  const from = now();
  await p.waitForTimeout(seconds * 1000);
  caps.push({ from, to: now(), text });
}
const lti = (p: Page, js: string) => p.evaluate(js);
async function scrollTo(p: Page, selector: string, block: 'start' | 'center' = 'start') {
  await p.evaluate(
    ([sel, b]) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: b as ScrollLogicalPosition }),
    [selector, block] as const,
  );
  await p.waitForTimeout(900);
}
async function playUntil(p: Page, iso: string, speed: number) {
  await lti(p, `lti.speed(${speed}); lti.resume()`);
  await p.waitForFunction((at) => {
    const s = (window as unknown as { lti: { state: () => { at: string | null; pos: number; total: number } } }).lti.state();
    return (!!s.at && s.at >= at) || s.pos >= s.total;
  }, iso, { timeout: 120000, polling: 50 });
  await lti(p, `lti.pause()`);
}

function card(title: string, lines: string[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html lang="en"><head><link rel="stylesheet" href="${base}/app.css"></head>
  <body style="display:grid;place-items:center;height:100vh;overflow:hidden">
  <div style="max-width:1300px;padding:0 60px">
    <div style="display:flex;align-items:center;gap:18px;margin-bottom:40px">
      <img src="${base}/door.svg" width="76" height="76" alt="">
      <span style="font:700 40px var(--display)">Let Them In</span>
    </div>
    <h1 style="font:800 92px/1.02 var(--display);letter-spacing:-0.03em;margin:0 0 28px">${esc(title)}</h1>
    ${lines.map((l) => `<p style="font-size:36px;line-height:1.35;margin:0 0 12px;color:var(--ink-2)">${esc(l)}</p>`).join('')}
  </div></body></html>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const p = await ctx.newPage();
t0 = Date.now();

// 1. title
await p.setContent(card('Who does your shop lock out?', ['AI shoppers with different access needs try a real web shop, in a real browser.']));
await p.waitForTimeout(800);
await caption(p, 'Let Them In sends AI shoppers into a real shop and shows who gets locked out.', 5);

// 2. the dashboard, first round on the released shop
await p.goto(`${base}/?dir=runs%2Fseries-b&replay=1&autoplay=0&speed=8&at=${encodeURIComponent(T.round1)}`);
await p.waitForTimeout(1500);
await caption(p, 'Five shoppers, one job: buy one thing with your own email at checkout. A visit only counts when the shop confirms the order.', 6);
await lti(p, 'lti.speed(6); lti.resume()');
await caption(p, 'Each one only gets what their need allows. Joel only has the keyboard. Maya only hears the screen reader.', 6);
await caption(p, 'Ines sees the page at 200 percent zoom. Kofi is on a slow phone. Tom has no access needs and is the baseline.', 7);
await caption(p, 'Everything on screen is the real recorded run, played back at 6x. Each card is that shopper’s screen right now.', 6);
await playUntil(p, T.joelOut1, 6);
await caption(p, 'On the released shop 4 of 5 got in. Joel was locked out.', 4);

// 3. why Joel was stuck
await lti(p, "lti.select({ shopper: 'joel', step: 26 })");
await scrollTo(p, '.lower');
await caption(p, 'Joel can’t see where the keyboard focus is. Add To Cart hides its focus outline.', 5);
await caption(p, 'In his words: “I think the Add To Cart button is focused, so I’ll press it to add this item.” It wasn’t.', 6);

// 4. fix 1
await lti(p, `lti.select({ shopper: null, step: null }); lti.seek('${T.fix1Writing}')`);
await scrollTo(p, '#fix', 'center');
await caption(p, 'The AI reads his steps, a free rule based check and the shop’s source code, and writes a patch.', 5);
await lti(p, `lti.seek('${T.fix1Built}')`);
await p.waitForTimeout(400);
await p.click('details.diff summary');
await p.waitForTimeout(500);
await caption(p, 'Fix 1 gives the shop’s buttons a focus outline. The shop is rebuilt from it with its own build.', 6);

// 5. round 2
await scrollTo(p, 'body');
await lti(p, `lti.seek('${T.round2}')`);
await caption(p, 'Then the same five shoppers go again on the fixed shop.', 4);
await playUntil(p, T.joelOut2, 12);
await caption(p, 'Joel can see the outline now. He still didn’t get in.', 4);
await lti(p, "lti.select({ shopper: 'joel', step: 28 })");
await scrollTo(p, '.lower');
await caption(p, 'Opening a product from “You May Also Like” leaves his focus down in those cards, so every Tab sends him round again.', 7);

// 6. fix 2
await lti(p, `lti.select({ shopper: null, step: null }); lti.seek('${T.fix2Built}')`);
await scrollTo(p, '#fix', 'center');
await caption(p, 'Fix 2 moves focus to Add To Cart when a product opens.', 6);

// 7. round 3
await scrollTo(p, 'body');
await lti(p, `lti.seek('${T.round3}')`);
await caption(p, 'Third round, same five shoppers.', 3);
await playUntil(p, T.end, 12);
await caption(p, 'Joel buys in 19 steps. 5 of 5 got in.', 5);
await scrollTo(p, '.lower', 'start');
await caption(p, 'Every step, screenshot and patch is saved. The three rounds and both fixes cost $2.53 in AI calls.', 7);
await scrollTo(p, 'body');
await lti(p, "lti.select({ round: '20261110-0338-before', shopper: 'kofi' })");
await caption(p, 'The dashboard also runs live while a round is going, and every round can be opened again to see each shopper.', 6);

// 8. end
await p.setContent(card('Let them in.', ['See who your shop locks out.', 'Fix it, then prove the fix worked with the same shoppers.']));
await p.waitForTimeout(600);
await caption(p, 'Let Them In.', 4);

await ctx.close();
await browser.close();

const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('no recording');
const fmt = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const srt = out.replace(/\.mp4$/, '.srt');
writeFileSync(srt, caps.map((c, i) => `${i + 1}\n${fmt(c.from)} --> ${fmt(c.to)}\n${c.text}\n`).join('\n'));
const style = 'FontName=Noto Sans,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H20000000,BackColour=&H20000000,BorderStyle=3,Outline=5,Shadow=0,MarginV=24,Bold=1';
execFileSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(tmp, webm), '-vf', `subtitles=${srt}:force_style='${style}'`, '-an', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', out],
  { stdio: 'inherit' },
);
rmSync(tmp, { recursive: true, force: true });
console.log(`${out} and ${srt}, ${caps.length} captions, ${now().toFixed(0)} s`);
