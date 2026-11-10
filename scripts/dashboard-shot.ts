// Screenshot of the dashboard, with any page errors printed.
// Usage: tsx scripts/dashboard-shot.ts <url> <out.png> [width] [height] [waitMs] [--full] [--eval <js run on the page first>]

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const ei = argv.indexOf('--eval');
const script = ei >= 0 ? argv.splice(ei, 2)[1] : '';
const [url, out, w = '1920', h = '1080', wait = '2500'] = argv.filter((a) => !a.startsWith('--'));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errs: string[] = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
await p.goto(url);
await p.waitForTimeout(Number(wait));
if (script) {
  await p.evaluate(script);
  await p.waitForTimeout(1200);
}
await p.screenshot({ path: out, fullPage: process.argv.includes('--full') });
console.log(errs.join('\n') || 'no page errors');
await b.close();
