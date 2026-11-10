// Scripted check, no AI: open the cart drawer on a phone and list what can be tapped.
import { openSession } from '../src/browser.js';
import { perceive } from '../src/perceive.js';
const shop = process.argv[2] ?? 'http://127.0.0.1:8090';
const s = await openSession((process.argv[3] as any) ?? 'mouse');
await s.page.goto(shop + '/product/1YMWWN1N4O', { waitUntil: 'load' });
await s.page.waitForTimeout(6000);
await s.page.getByText('Add To Cart').click();
await s.page.waitForURL(/\/cart/);
await s.page.waitForTimeout(6000);
await s.page.locator('[data-cy="cart-icon"]').click();
await s.page.waitForTimeout(1000);
const o = await perceive(s.page, (process.argv[3] as any) ?? 'mouse');
console.log(o.text);
await s.browser.close();
