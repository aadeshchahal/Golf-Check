import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso } from "../time.js";

// Adapter for PerfectMind / Xplor "MoveLearnPlay" (City of Edmonton:
// Victoria, Riverside).
//
// PerfectMind has no documented public JSON API and blocks plain/datacenter
// HTTP requests, so this adapter drives a real headless browser (Playwright).
// It loads the public golf course page for the requested date and captures the
// availability XHR the page fires, then maps it to normalized TeeTimes.
//
// The exact XHR URL + JSON shape is confirmed by `npm run discover`. The
// capture heuristic and mapping below are intentionally generic; once you have
// the discovery output, tighten `looksLikeAvailability` and `mapSlot` to the
// real fields. Mapping is marked NEEDS-VERIFICATION until you've run discovery
// on a machine with internet access.

// Lazy singleton browser so we don't relaunch chromium on every request.
let browserPromise: Promise<import("playwright").Browser> | null = null;
async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = await import("playwright");
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

function courseUrl(course: Course, date: string): string {
  const cfg = course.perfectmind!;
  return `https://${cfg.host}${cfg.basePath}/golf/course/${cfg.guid}?date=${date}`;
}

function looksLikeAvailability(url: string): boolean {
  return /calendar|teetime|tee-time|availability|booking|slots|schedule/i.test(url);
}

// NEEDS-VERIFICATION: adjust field names to the real PerfectMind payload.
interface RawSlot {
  time?: string;
  startTime?: string;
  start?: string;
  spots?: number;
  available?: number;
  capacity?: number;
  price?: number;
  fee?: number;
  holes?: number;
  nbHoles?: number;
}

function extractTime(s: RawSlot): string | null {
  const raw = s.time ?? s.startTime ?? s.start;
  if (!raw) return null;
  // Accept "HH:mm", "HH:mm:ss", or an ISO timestamp.
  const hm = /(\d{1,2}):(\d{2})/.exec(raw);
  return hm ? `${hm[1]}:${hm[2]}` : null;
}

function extractSpots(s: RawSlot): number {
  const v = s.spots ?? s.available ?? s.capacity ?? 0;
  return Math.max(0, Math.min(4, Number(v) || 0));
}

export const perfectMindAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
    if (!course.perfectmind) throw new Error(`${course.id}: missing perfectmind config`);

    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-CA",
    });
    const page = await context.newPage();

    const captured: RawSlot[] = [];
    page.on("response", async (res) => {
      try {
        if (!looksLikeAvailability(res.url())) return;
        const ct = res.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const body = await res.json();
        const arr = Array.isArray(body) ? body : (body?.results ?? body?.data ?? body?.items);
        if (Array.isArray(arr)) captured.push(...(arr as RawSlot[]));
      } catch {
        /* ignore non-JSON / parse errors */
      }
    });

    try {
      await page.goto(courseUrl(course, date), { waitUntil: "networkidle", timeout: 30_000 });
      // Give late XHRs a moment to land.
      await page.waitForTimeout(1500);
    } finally {
      await context.close();
    }

    if (captured.length === 0) {
      throw new Error(
        `${course.id}: no availability data captured — run \`npm run discover\` to confirm the MoveLearnPlay XHR shape, then update mapSlot in perfectmind.ts`,
      );
    }

    const out: TeeTime[] = [];
    for (const slot of captured) {
      const t = extractTime(slot);
      if (!t) continue;
      const spots = extractSpots(slot);
      if (spots <= 0) continue;
      // PerfectMind may not split 9/18 the same way; if the payload carries a
      // hole count, respect it, otherwise assume the page's selected holes.
      const slotHoles = (slot.holes ?? slot.nbHoles) as Holes | undefined;
      if (slotHoles && slotHoles !== holes) continue;
      const localTime = pad(t);
      out.push({
        course: course.name,
        courseId: course.id,
        startTime: toIso(date, localTime, course.timezone),
        localTime,
        holes,
        price: slot.price ?? slot.fee ?? null,
        currency: "CAD",
        playersAvailable: spots,
        bookingUrl: courseUrl(course, date),
      });
    }
    return out;
  },
};
