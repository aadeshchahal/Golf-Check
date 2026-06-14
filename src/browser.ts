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

// Heavy resource types we never read — blocking them keeps these slow legacy
// pages fast (without it, Tee-On searches balloon to ~30-60s). By default we
// also block "stylesheet". EXCEPTION: some Tee-On courses run a CSS-driven
// "wait timer" overlay and only render their tee-time cards with CSS present;
// for those, pass { allowStyles: true } (they stay slower — the overlay gates
// the search — but they return data). Document/script/xhr/fetch are always
// allowed: the PerfectMind queue JS + in-page TeeTimeSearch fetch and Tee-On's
// card rendering all depend on them.
const HEAVY = ["image", "media", "font"];

export interface ContextOpts {
  /** Keep stylesheets — needed by Tee-On courses whose cards are CSS-gated. */
  allowStyles?: boolean;
}

/** Create a fresh, isolated context with our UA + resource blocking. The caller
 *  owns it and must close it — used by the PerfectMind warm pool, which keeps a
 *  context alive across requests. For one-shot work prefer `withContext`. */
export async function newContext(opts: ContextOpts = {}): Promise<BrowserContext> {
  const browser = await getBrowser();
  const blocked = new Set(opts.allowStyles ? HEAVY : [...HEAVY, "stylesheet"]);
  const ctx = await browser.newContext({ userAgent: USER_AGENT, locale: "en-CA" });
  await ctx.route("**/*", (route) =>
    blocked.has(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  return ctx;
}

/** Run `fn` with a fresh, isolated browser context that is always closed. */
export async function withContext<T>(
  fn: (ctx: BrowserContext) => Promise<T>,
  opts: ContextOpts = {},
): Promise<T> {
  const ctx = await newContext(opts);
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
