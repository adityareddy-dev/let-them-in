// Runs axe-core on the dashboard, since a page about access should pass its own check.
// It also presses Tab through the page and lists any stop that shows no focus outline.
// Usage: tsx scripts/check-dashboard.ts <dashboard url> [more urls]
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';

const urls = process.argv.slice(2);
if (!urls.length) throw new Error('usage: tsx scripts/check-dashboard.ts <url> [url ...]');
const browser = await chromium.launch();
let failed = 0;
for (const url of urls) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(2500);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of r.violations) console.log(`${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}\n  ${v.nodes[0]?.html.slice(0, 160)}`);
  console.log(`${r.violations.length} rules failed on ${url}`);
  failed += r.violations.length;
  // Tab walk: every stop should have a visible outline or box shadow
  const hidden: string[] = [];
  let stops = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const shows = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      return { name: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}`, shows };
    });
    if (!s) break;
    stops++;
    if (!s.shows) hidden.push(s.name);
  }
  console.log(`${stops} tab stops, ${hidden.length} without a visible focus style${hidden.length ? ': ' + hidden.join(' | ') : ''}`);
  failed += hidden.length;
  await context.close();
}
await browser.close();
process.exitCode = failed ? 1 : 0;
