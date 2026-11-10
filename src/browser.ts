// A real Chromium for each shopper, set up the way their access need works.

import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Mode } from './shoppers.js';

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

interface Setup {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent?: string;
}

export function setupFor(mode: Mode): Setup {
  switch (mode) {
    case 'zoom':
      // 200 percent zoom in a 1280x800 window leaves 640x400 CSS pixels, drawn twice as large.
      return { viewport: { width: 640, height: 400 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false };
    case 'slowphone': {
      const d = devices['Moto G4'];
      return {
        viewport: d.viewport,
        deviceScaleFactor: d.deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
        userAgent: d.userAgent,
      };
    }
    default:
      return { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
  }
}

export async function openSession(mode: Mode, videoDir?: string): Promise<Session> {
  const browser = await chromium.launch();
  const s = setupFor(mode);
  const context = await browser.newContext({
    ...s,
    locale: 'en-US',
    recordVideo: videoDir ? { dir: videoDir, size: { width: 1280, height: 800 } } : undefined,
  });
  const page = await context.newPage();
  if (mode === 'slowphone') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    // Roughly a weak 3G connection and a phone CPU four times slower than the server.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (250 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  return { browser, context, page };
}

// Wait for the page to settle, but only as long as a person would.
export async function settle(page: Page, patienceMs: number): Promise<void> {
  try {
    await page.waitForLoadState('load', { timeout: patienceMs });
    await page.waitForLoadState('networkidle', { timeout: Math.min(2000, patienceMs) });
  } catch {
    // Still loading. The shopper sees whatever is there.
  }
}
