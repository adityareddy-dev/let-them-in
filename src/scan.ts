// A check with no model calls. axe-core looks at the shop pages, and a scripted keyboard walk
// presses Tab through the product page and notes whether each stop shows where focus is.
// It backs up what the shoppers report with rule-based findings.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Page } from 'playwright';

export interface AxeFinding {
  page: string;
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: { target: string; html: string }[];
}

export interface TabStop {
  n: number;
  tag: string;
  name: string;
  visibleFocus: boolean;
}

export interface ScanResult {
  shopUrl: string;
  at: string;
  findings: AxeFinding[];
  tabStops: TabStop[];
  addToCartTabStop: number | null;
  addToCartShowsFocus: boolean | null;
  checkoutFormHeard: string;
  focusAfterOpeningCard?: { card: string; afterEnter: string; afterTab: string; scrollAfterTab: number };
}

async function axe(page: Page, label: string): Promise<AxeFinding[]> {
  await page.waitForTimeout(2500);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => ({
    page: label,
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 200) })),
  }));
}

export async function tabWalk(page: Page, max = 60): Promise<TabStop[]> {
  const stops: TabStop[] = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } }).catch(() => {});
  for (let n = 1; n <= max; n++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const st = getComputedStyle(el);
      const outline = st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0;
      const shadow = st.boxShadow && st.boxShadow !== 'none';
      return {
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') || el.innerText || (el as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        visibleFocus: Boolean(outline || shadow),
      };
    });
    if (!s) break;
    stops.push({ n, ...s });
  }
  return stops;
}

// Open a "You May Also Like" card by keyboard, then press Tab once. Where does focus go?
export async function focusAfterOpeningCard(page: Page, productUrl: string): Promise<ScanResult['focusAfterOpeningCard']> {
  await page.goto(productUrl, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const name = el ? (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50) : '';
      return { what: el ? `${el.tagName.toLowerCase()} "${name}"` : 'nothing', y: Math.round(scrollY), card: !!el && el.tagName === 'A' && name.includes('$') };
    });
  let card = '';
  for (let i = 0; i < 25 && !card; i++) {
    await page.keyboard.press('Tab');
    const f = await focused();
    if (f.card) card = f.what;
  }
  if (!card) return undefined;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  const afterEnter = (await focused()).what;
  await page.keyboard.press('Tab');
  const t = await focused();
  return { card, afterEnter, afterTab: t.what, scrollAfterTab: t.y };
}

export async function scan(shopUrl: string, outDir: string): Promise<ScanResult> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const findings: AxeFinding[] = [];
  try {
    await page.goto(shopUrl, { waitUntil: 'load', timeout: 60000 });
    findings.push(...(await axe(page, 'home')));
    const first = page.locator('a[href^="/product/"]').first();
    const href = await first.getAttribute('href');
    await page.goto(new URL(href ?? '/', shopUrl).toString(), { waitUntil: 'load' });
    findings.push(...(await axe(page, 'product')));
    const tabStops = await tabWalk(page);
    const hit = tabStops.find((s) => /add to cart/i.test(s.name));
    await page.goto(new URL(href ?? '/', shopUrl).toString(), { waitUntil: 'load' });
    await page.getByText('Add To Cart').click();
    await page.waitForURL(/\/cart/, { timeout: 15000 });
    await page.waitForTimeout(2500);
    findings.push(...(await axe(page, 'cart and checkout form')));
    // what a screen reader gets from the checkout form
    const checkoutFormHeard = await page.locator('form').first().ariaSnapshot().catch(() => '');
    const nav = await focusAfterOpeningCard(page, new URL(href ?? '/', shopUrl).toString()).catch(() => undefined);
    const result: ScanResult = {
      shopUrl,
      at: new Date().toISOString(),
      findings,
      tabStops,
      addToCartTabStop: hit?.n ?? null,
      addToCartShowsFocus: hit ? hit.visibleFocus : null,
      checkoutFormHeard,
      focusAfterOpeningCard: nav,
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'scan.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    await browser.close();
  }
}
