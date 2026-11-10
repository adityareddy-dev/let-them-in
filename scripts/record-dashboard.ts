// Records the dashboard in a real browser for a while: a video of the screen and a screenshot every 20 s.
// Usage: tsx scripts/record-dashboard.ts <url> <out dir> <seconds>

import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [url, out, seconds = '60'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const size = { width: 1920, height: 1080 };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: size, recordVideo: { dir: out, size } });
const p = await ctx.newPage();
await p.goto(url);
const end = Date.now() + Number(seconds) * 1000;
let n = 0;
while (Date.now() < end) {
  await p.waitForTimeout(Math.min(20000, end - Date.now()));
  await p.screenshot({ path: join(out, `live-${String(++n).padStart(2, '0')}.png`) });
}
await ctx.close();
await b.close();
const v = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'dashboard.webm');
if (v) renameSync(join(out, v), join(out, 'dashboard.webm'));
console.log(`recorded ${n} screenshots and dashboard.webm in ${out}`);
