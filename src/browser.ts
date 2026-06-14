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

/** Launch Chromium ahead of the first request so a search doesn't pay the
 *  ~1-2s launch cost. Fire-and-forget from server startup. */
export async function warmBrowser(): Promise<void> {
  await getBrowser();
}

// Heavy resources we never read — we only parse the page's HTML/DOM. Aborting
// these cuts page-load time and bandwidth a lot. We deliberately never block
// document/script/xhr/fetch: the PerfectMind queue JS, Tee-On's client-side
// card rendering, and the in-page TeeTimeSearch fetch all depend on them.
const BLOCKED_RESOURCES = new Set(["image", "media", "font", "stylesheet"]);

/** Run `fn` with a fresh, isolated browser context that is always closed. */
export async function withContext<T>(fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: "en-CA" });
  await ctx.route("**/*", (route) =>
    BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
  );
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
