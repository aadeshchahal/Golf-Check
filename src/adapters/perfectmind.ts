import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso, zoneOffset } from "../time.js";
import { withContext } from "../browser.js";

// Adapter for PerfectMind / Xplor "MoveLearnPlay" (City of Edmonton: Victoria,
// Riverside).
//
// Booking sits behind a virtual-queue, so this drives a real browser:
//
//   golf/sendtoqueue?categoryGUID=…&golfCourse=<GUID>
//     -> /queue/wait  (polls /queue/MyPosition until released, ~seconds off-peak)
//     -> /golf/teetimesearch   (sets the session + antiforgery token)
//
// From the search page we POST the search directly (cleaner than driving the
// calendar widget):
//
//   POST /COE/public/golf/TeeTimeSearch
//     __RequestVerificationToken, selectedGolfCourse=<GUID>,
//     SearchDate=<localMidnightUTC>, Time=, NumberOfHoles=9|18, NumberOfPlayers=1
//
// The response is HTML with one button per slot:
//   <button data-time="7:24 AM" data-spaces="4" data-holegroup="Front 9">…
// PerfectMind doesn't surface a price here, so price is null (the City's green
// fees are fixed and shown on the booking page).

interface RawSlot {
  time: string | null; // "7:24 AM"
  spaces: string | null; // "4"
}

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

export const perfectMindAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
    const cfg = course.perfectmind;
    if (!cfg) throw new Error(`${course.id}: missing perfectmind config`);

    return withContext(async (ctx) => {
      const page = await ctx.newPage();
      await page.goto(queueUrl(course), { waitUntil: "domcontentloaded", timeout: 60_000 });

      // Wait out the virtual queue: it redirects to the search page when ready.
      // waitForURL resolves the instant we're released (and immediately if we're
      // already past the queue), instead of polling the URL every 2s.
      await page.waitForURL(/teetimesearch/i, { timeout: 60_000 }).catch(() => {});
      if (!/teetimesearch/i.test(page.url())) {
        throw new Error(`${course.id}: still queued after 60s (peak load) — try again`);
      }

      // Read the antiforgery token as soon as the search form is in the DOM,
      // rather than blocking on a fixed delay.
      await page
        .waitForSelector('input[name="__RequestVerificationToken"]', { timeout: 10_000 })
        .catch(() => {});
      const token = String(
        await page.evaluate(
          `(document.querySelector('input[name="__RequestVerificationToken"]') || {}).value || ''`,
        ),
      );
      if (!token) throw new Error(`${course.id}: no antiforgery token on search page`);

      const body = new URLSearchParams({
        __RequestVerificationToken: token,
        selectedGolfCourse: cfg.guid,
        SearchDate: searchDate(date, course.timezone),
        Time: "",
        NumberOfHoles: String(holes),
        NumberOfPlayers: "1", // "Any" — we report real spots and filter later
        "X-Requested-With": "XMLHttpRequest",
      }).toString();

      const slots = (await page.evaluate(
        `(function () {
          return fetch(${JSON.stringify(`${cfg.basePath}/golf/TeeTimeSearch`)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            body: ${JSON.stringify(body)},
          })
            .then(function (r) { return r.text(); })
            .then(function (html) {
              var doc = new DOMParser().parseFromString(html, 'text/html');
              var btns = Array.prototype.slice.call(doc.querySelectorAll('button[data-time]'));
              return btns.map(function (b) {
                return { time: b.getAttribute('data-time'), spaces: b.getAttribute('data-spaces') };
              });
            })
            .catch(function (e) { return { error: String(e) }; });
        })()`,
      )) as RawSlot[] | { error: string };

      if (!Array.isArray(slots)) {
        throw new Error(`${course.id}: tee time search failed (${(slots as { error: string }).error})`);
      }

      const out: TeeTime[] = [];
      for (const s of slots) {
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
    });
  },
};
