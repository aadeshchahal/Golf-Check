import type { BrowserContext, Page } from "playwright";
import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso, zoneOffset } from "../time.js";
import { newContext, withContext } from "../browser.js";

// Adapter for PerfectMind / Xplor "MoveLearnPlay" (City of Edmonton: Victoria,
// Riverside).
//
// Booking sits behind a virtual-queue, so this drives a real browser:
//
//   golf/sendtoqueue?categoryGUID=…&golfCourse=<GUID>
//     -> /queue/wait  (redirects to the search page when released, ~seconds
//        off-peak but up to ~tens of seconds under load)
//     -> /golf/teetimesearch   (sets the session cookie + antiforgery token)
//
// From the search page we POST the search directly:
//
//   POST /COE/public/golf/TeeTimeSearch
//     __RequestVerificationToken, selectedGolfCourse=<GUID>,
//     SearchDate=<localMidnightUTC>, Time=, NumberOfHoles=9|18, NumberOfPlayers=1
//
// The response is HTML with one button per slot:
//   <button data-time="7:24 AM" data-spaces="4" data-holegroup="Front 9">…
// PerfectMind doesn't surface a price here, so price is null (the City's green
// fees are fixed and shown on the booking page).
//
// WARM POOL: a queue-released session can POST many searches, so we keep its
// page alive per course (the pool below), warmed lazily on the first search.
// Subsequent searches reuse it and skip the queue (~33s cold -> ~14s warm; the
// remaining ~14s is the City's TeeTimeSearch endpoint itself, which is slow —
// that's why it's queue-gated — and is the floor we can't beat). Reuse is
// REACTIVE ONLY: there is no background keep-alive, so the pool adds no load to
// the City's backend; a session older than MAX_AGE_MS is re-warmed on the next
// search, and anything going wrong falls back to a clean on-demand handshake —
// the pool only ever makes things faster, never worse. Disable with
// PERFECTMIND_PREWARM=0.

interface RawSlot {
  time: string | null; // "7:24 AM"
  spaces: string | null; // "4"
}

/** Thrown when a warm session has lost its place (the search POST got bounced
 *  back to the queue/login) so callers can drop it and re-warm. */
class ExpiredSession extends Error {}

function queueUrl(course: Course): string {
  const cfg = course.perfectmind!;
  return `https://${cfg.host}${cfg.basePath}/golf/sendtoqueue?categoryGUID=${cfg.categoryGuid}&golfCourse=${cfg.guid}`;
}

function courseUrl(course: Course): string {
  const cfg = course.perfectmind!;
  return `https://${cfg.host}${cfg.basePath}/golf/course/${cfg.guid}`;
}

/** PerfectMind's SearchDate is local midnight expressed in UTC, e.g. summer
 *  (MDT, -06:00) -> "2026-06-20T06:00:00.000Z". */
function searchDate(date: string, timeZone: string): string {
  const offset = zoneOffset(date, timeZone); // "-06:00" / "-07:00"
  const hh = offset.slice(1, 3); // "06" / "07"
  return `${date}T${hh}:00:00.000Z`;
}

/** "7:24 AM" -> "07:24". */
function to24h(s: string): string | null {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// ---- low-level steps (shared by the warm + on-demand paths) ---------------

/** Drive a fresh page through the virtual queue onto the tee-time search page. */
async function handshake(page: Page, course: Course): Promise<void> {
  await page.goto(queueUrl(course), { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait out the virtual queue: it redirects to the search page when released.
  // waitForURL resolves the instant we're released (and immediately if we're
  // already past the queue), instead of polling the URL every 2s.
  await page.waitForURL(/teetimesearch/i, { timeout: 60_000 }).catch(() => {});
  if (!/teetimesearch/i.test(page.url())) {
    throw new Error(`${course.id}: still queued after 60s (peak load) — try again`);
  }

  await page
    .waitForSelector('input[name="__RequestVerificationToken"]', { timeout: 10_000 })
    .catch(() => {});
}

/** POST the search on a page that's already on the tee-time search page and
 *  normalize the slots. Throws ExpiredSession if the session was lost. */
async function runSearch(page: Page, course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
  const cfg = course.perfectmind!;

  const token = String(
    await page.evaluate(
      `(document.querySelector('input[name="__RequestVerificationToken"]') || {}).value || ''`,
    ),
  );
  if (!token) throw new ExpiredSession(`${course.id}: no antiforgery token on search page`);

  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    selectedGolfCourse: cfg.guid,
    SearchDate: searchDate(date, course.timezone),
    Time: "",
    NumberOfHoles: String(holes),
    NumberOfPlayers: "1", // "Any" — we report real spots and filter later
    "X-Requested-With": "XMLHttpRequest",
  }).toString();

  const result = (await page.evaluate(
    `(function () {
      return fetch(${JSON.stringify(`${cfg.basePath}/golf/TeeTimeSearch`)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: ${JSON.stringify(body)},
      })
        .then(function (r) {
          // A lost session bounces the POST back to the queue/login page; a live
          // one returns the results fragment directly (200, no redirect).
          if (r.redirected || r.status >= 400) return { expired: true, status: r.status };
          return r.text().then(function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var btns = Array.prototype.slice.call(doc.querySelectorAll('button[data-time]'));
            return { slots: btns.map(function (b) {
              return { time: b.getAttribute('data-time'), spaces: b.getAttribute('data-spaces') };
            }) };
          });
        })
        .catch(function (e) { return { error: String(e) }; });
    })()`,
  )) as { slots?: RawSlot[]; expired?: boolean; error?: string };

  if (result.expired) throw new ExpiredSession(`${course.id}: warm session expired`);
  if (!result.slots) {
    throw new Error(`${course.id}: tee time search failed (${result.error ?? "unknown"})`);
  }

  const out: TeeTime[] = [];
  for (const s of result.slots) {
    if (!s.time) continue;
    const hm = to24h(s.time);
    if (!hm) continue;
    const open = Math.max(0, Math.min(4, Number(s.spaces ?? 0)));
    if (open <= 0) continue;
    const localTime = pad(hm);
    out.push({
      course: course.name,
      courseId: course.id,
      startTime: toIso(date, localTime, course.timezone),
      localTime,
      holes,
      price: null,
      currency: "CAD",
      playersAvailable: open,
      bookingUrl: courseUrl(course),
    });
  }
  return out;
}

/** One-shot search in a throwaway context — pays the queue, used when the warm
 *  pool is disabled or as the fallback when a warm search fails. */
async function onDemandSearch(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
  return withContext(async (ctx) => {
    const page = await ctx.newPage();
    await handshake(page, course);
    return runSearch(page, course, date, holes);
  });
}

// ---- warm pool ------------------------------------------------------------

const PREWARM = process.env.PERFECTMIND_PREWARM !== "0"; // on unless explicitly disabled
// Re-warm a pooled session once it is older than this. REACTIVE ONLY: the
// re-warm happens on the next user search, never on a timer, so the pool adds
// zero background load to the City's capacity-limited (queue-gated) backend.
const MAX_AGE_MS = Number(process.env.PERFECTMIND_MAX_AGE_MS ?? 15 * 60 * 1000);

interface Warm {
  ctx: BrowserContext;
  page: Page;
  createdAt: number;
}

const pool = new Map<string, Warm>();
const inflight = new Map<string, Promise<Warm>>();

async function createWarm(course: Course): Promise<Warm> {
  const ctx = await newContext();
  const page = await ctx.newPage();
  try {
    await handshake(page, course);
  } catch (e) {
    await ctx.close().catch(() => {});
    throw e;
  }
  const warm: Warm = { ctx, page, createdAt: Date.now() };
  pool.set(course.id, warm);
  return warm;
}

/** A warm, queue-released page for the course, warming one if needed. Reuses a
 *  live session (skipping the queue); a session past MAX_AGE_MS is discarded and
 *  re-warmed on this call. Concurrent callers share a single in-flight warm. */
async function ensureWarm(course: Course): Promise<Warm> {
  const existing = pool.get(course.id);
  if (existing && Date.now() - existing.createdAt <= MAX_AGE_MS) return existing;
  if (existing) await invalidate(course.id);
  const pending = inflight.get(course.id);
  if (pending) return pending;
  const p = createWarm(course).finally(() => inflight.delete(course.id));
  inflight.set(course.id, p);
  return p;
}

async function invalidate(courseId: string): Promise<void> {
  const w = pool.get(courseId);
  if (!w) return;
  pool.delete(courseId);
  await w.ctx.close().catch(() => {});
}

/** Tear down the pool (held contexts) on shutdown. */
export async function closePerfectMindPool(): Promise<void> {
  await Promise.all([...pool.keys()].map((id) => invalidate(id)));
}

export const perfectMindAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
    if (!course.perfectmind) throw new Error(`${course.id}: missing perfectmind config`);
    if (!PREWARM) return onDemandSearch(course, date, holes);

    try {
      const warm = await ensureWarm(course);
      return await runSearch(warm.page, course, date, holes);
    } catch (e) {
      // A stale warm session: drop it, re-warm once, retry.
      if (e instanceof ExpiredSession) {
        await invalidate(course.id);
        try {
          const warm = await ensureWarm(course);
          return await runSearch(warm.page, course, date, holes);
        } catch {
          // fall through to the clean on-demand path
        }
      }
      // Any failure: fall back so a flaky pool never beats the on-demand path.
      return onDemandSearch(course, date, holes);
    }
  },
};
