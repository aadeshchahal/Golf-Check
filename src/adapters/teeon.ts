import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso } from "../time.js";
import { withContext } from "../browser.js";

// Adapter for Tee-On Golf Systems (Mill Woods, Coloniale).
//
// Tee-On has no JSON API; the public tee sheet is server-rendered and driven
// through a short flow, so we use a real browser:
//
//   ComboLanding?CourseCode=XXX            (establishes the public session)
//   -> WebBookingSearchSteps?CourseGroupID=NNN&CourseCode=XXX&LoginType=5
//        (a form: Date / SearchTime / Holes / Players)
//   -> POST WebBookingSearchResults        (renders the bookable tee times)
//
// Tee-On filters the sheet by party size upstream (it won't show a slot that
// can't seat the requested group), so we search with the requested `players`.
// Each result card embeds its data in an onclick handler:
//   isNotLocked('MILL','F','2026-06-20','07:17', 18, 4, …)
//                 code   side  date         time   holes spots
// and a `.price` element. We read open spots from that 6th argument.

const SERVLET = "https://www.tee-on.com/PubGolf/servlet/com.teeon.teesheet.servlets.golfersection";

interface RawCard {
  side: string;
  time: string; // "HH:mm" 24h
  holes: number;
  spots: number;
  price: string; // "$70.00"
}

function comboUrl(code: string): string {
  return `${SERVLET}.ComboLanding?CourseCode=${code}&FromCourseWebsite=true`;
}

function searchUrl(groupId: number, code: string): string {
  return `${SERVLET}.WebBookingSearchSteps?CourseGroupID=${groupId}&CourseCode=${code}&LoginType=5&BackTarget=com.teeon.teesheet.servlets.golfersection.ComboLanding&Referrer=`;
}

function parsePrice(s: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(s.replace(/,/g, ""));
  return m ? Number(m[1]) : null;
}

export const teeOnAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes, players: number): Promise<TeeTime[]> {
    const cfg = course.teeon;
    if (!cfg) throw new Error(`${course.id}: missing teeon config`);

    return withContext(async (ctx) => {
      const page = await ctx.newPage();

      await page.goto(comboUrl(cfg.courseCode), { waitUntil: "networkidle", timeout: 45_000 });
      await page.goto(searchUrl(cfg.courseGroupId, cfg.courseCode), { waitUntil: "networkidle", timeout: 45_000 });

      // Tee-On only offers a fixed booking window in the Date dropdown.
      const hasDate = await page.evaluate(
        `!!document.querySelector('select[name="Date"] option[value="${date}"]')`,
      );
      if (!hasDate) {
        throw new Error(`${course.id}: ${date} is outside Tee-On's booking window`);
      }

      await page.selectOption('select[name="Date"]', date);
      await page.check(`input[name="Holes"][value="${holes}"]`).catch(() => {});
      await page.check(`input[name="Players"][value="${players}"]`).catch(() => {});

      // Submit the search form (no plain submit button; it posts via script).
      // Set up the navigation wait BEFORE triggering submit to avoid a race.
      const nav = page.waitForURL(/WebBookingSearchResults/i, { timeout: 45_000 }).catch(() => {});
      await page.evaluate(`document.querySelector('form').submit()`);
      await nav;
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

      if (!/WebBookingSearchResults/i.test(page.url())) {
        throw new Error(`${course.id}: Tee-On search did not return results`);
      }
      // Result cards render client-side; wait briefly, tolerate "no times".
      await page
        .waitForSelector(".search-results-tee-times-box", { timeout: 8000 })
        .catch(() => {});

      const cards = (await page.evaluate(
        `(function () {
          var code = ${JSON.stringify(cfg.courseCode)};
          var re = /isNotLocked\\(\\s*'([^']+)'\\s*,\\s*'([^']+)'\\s*,\\s*'([^']+)'\\s*,\\s*'([^']+)'\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/;
          var boxes = Array.prototype.slice.call(document.querySelectorAll('.search-results-tee-times-box'));
          var out = [];
          for (var i = 0; i < boxes.length; i++) {
            var oc = boxes[i].getAttribute('onclick') || '';
            var m = oc.match(re);
            if (!m || m[1] !== code) continue;
            var p = boxes[i].querySelector('.price');
            out.push({ side: m[2], time: m[4], holes: Number(m[5]), spots: Number(m[6]), price: p ? p.innerText : '' });
          }
          return out;
        })()`,
      )) as RawCard[];

      const out: TeeTime[] = [];
      for (const c of cards) {
        if (c.holes !== holes) continue;
        const open = Math.max(0, Math.min(4, c.spots));
        if (open <= 0) continue;
        const localTime = pad(c.time);
        out.push({
          course: course.name,
          courseId: course.id,
          startTime: toIso(date, localTime, course.timezone),
          localTime,
          holes,
          price: parsePrice(c.price),
          currency: "CAD",
          playersAvailable: open,
          bookingUrl: searchUrl(cfg.courseGroupId, cfg.courseCode),
        });
      }
      return out;
    });
  },
};
