import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso } from "../time.js";

// Adapter for ForeUp Software (Eagle Rock).
//
// ForeUp exposes a public JSON availability API used by its own booking widget;
// no auth or browser is needed:
//
//   GET https://foreupsoftware.com/index.php/api/booking/times
//        ?time=all&date=MM-DD-YYYY&holes=all&players=0
//        &booking_class=<id>&schedule_id=<id>&schedule_ids[]=<id>
//        &specials_only=0&api_key=no_limits
//
// It returns one object per tee time carrying open-spot counts and green fees
// split by hole count (…_9 / …_18), so we query the whole sheet once and read
// the fields for the requested hole count.

const BOOKING_HOST = "https://foreupsoftware.com";

interface RawTime {
  time?: string; // "YYYY-MM-DD HH:mm"
  available_spots?: number;
  available_spots_9?: number;
  available_spots_18?: number;
  green_fee?: number | false;
  green_fee_9?: number | false;
  green_fee_18?: number | false;
}

/** ForeUp wants the date as MM-DD-YYYY. */
function foreupDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}-${d}-${y}`;
}

function num(v: number | false | undefined): number | null {
  return typeof v === "number" ? v : null;
}

function bookingUrl(courseId: number): string {
  return `${BOOKING_HOST}/index.php/booking/index/${courseId}#/teetimes`;
}

export const foreUpAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
    const cfg = course.foreup;
    if (!cfg) throw new Error(`${course.id}: missing foreup config`);

    const url = new URL(`${BOOKING_HOST}/index.php/api/booking/times`);
    url.searchParams.set("time", "all");
    url.searchParams.set("date", foreupDate(date));
    url.searchParams.set("holes", String(holes));
    url.searchParams.set("players", "0"); // 0 = no party-size filter
    url.searchParams.set("booking_class", String(cfg.bookingClass));
    url.searchParams.set("schedule_id", String(cfg.scheduleId));
    url.searchParams.append("schedule_ids[]", String(cfg.scheduleId));
    url.searchParams.set("specials_only", "0");
    url.searchParams.set("api_key", "no_limits");

    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "api-key": "no_limits",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!res.ok) throw new Error(`${course.id}: HTTP ${res.status} from foreup`);

    const raw = (await res.json()) as RawTime[];
    const out: TeeTime[] = [];
    for (const slot of raw) {
      if (!slot.time) continue;
      const hm = /\d{4}-\d{2}-\d{2}[ T](\d{1,2}:\d{2})/.exec(slot.time);
      if (!hm) continue;

      const spots = holes === 9 ? slot.available_spots_9 : slot.available_spots_18;
      const open = Math.max(0, Math.min(4, Number(spots ?? slot.available_spots ?? 0)));
      if (open <= 0) continue;

      const fee = holes === 9 ? num(slot.green_fee_9) : num(slot.green_fee_18);
      const localTime = pad(hm[1]);
      out.push({
        course: course.name,
        courseId: course.id,
        startTime: toIso(date, localTime, course.timezone),
        localTime,
        holes,
        price: fee ?? num(slot.green_fee),
        currency: "CAD",
        playersAvailable: open,
        bookingUrl: bookingUrl(cfg.courseId),
      });
    }
    return out;
  },
};
