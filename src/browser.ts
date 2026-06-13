// Shared lazy-singleton Chromium for the browser-driven adapters (Tee-On,
// PerfectMind), so we don't relaunch Chromium on every request. The server
// calls closeBrowser() on shutdown.

import type { Browser, BrowserContext } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const { chromium } = await import("playwright");
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

/** Run `fn` with a fresh, isolated browser context that is always closed. */
export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: "en-CA" });
  try {
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
