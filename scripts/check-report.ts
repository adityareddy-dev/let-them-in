// Runs axe-core on the built report, since a page about access should pass its own check.
// Usage: tsx scripts/check-report.ts [report/index.html]
import { resolve } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';

const file = resolve(process.argv[2] ?? 'report/index.html');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto('file://' + file);
const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
for (const v of r.violations) console.log(`${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}\n  ${v.nodes[0]?.html.slice(0, 160)}`);
console.log(`${r.violations.length} rules failed on ${file}`);
await browser.close();
process.exitCode = r.violations.length ? 1 : 0;
