import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso } from "../time.js";

// Adapter for Chronogolf / Lightspeed Golf — Broadmoor (Sherwood Park).
//
// The booking widget reads a public JSON API; no auth or browser needed:
//
//   GET https://<host>/marketplace/clubs/<clubId>/teetimes
//        ?date=YYYY-MM-DD&course_id=<courseId>&nb_holes=9|18
//        &affiliation_type_ids[]=<publicId>  (repeated once per player)
//
// Like Tee-On, party size is enforced upstream: you pass the public player-type
// id once per requested golfer, and each slot reports `out_of_capacity` for that
// party. So we request with `players` ids and keep slots that fit (the adapter
// takes `players`, and aggregate.ts keys this backend's cache by party size).
// Each slot carries a local "HH:mm" `start_time` and `green_fees[].green_fee`.

interface GreenFee {
  green_fee?: number;
  price?: number;
}
interface Slot {
  start_time?: string; // "07:00" local
  out_of_capacity?: boolean;
  green_fees?: GreenFee[];
}

function bookingUrl(cfg: NonNullable<Course["chronogolf"]>): string {
  return `https://${cfg.host}/club/${cfg.slug}/widget?source=club`;
}

export const chronogolfAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes, players: number): Promise<TeeTime[]> {
    const cfg = course.chronogolf;
    if (!cfg) throw new Error(`${course.id}: missing chronogolf config`);

    const url = new URL(`https://${cfg.host}/marketplace/clubs/${cfg.clubId}/teetimes`);
    url.searchParams.set("date", date);
    url.searchParams.set("course_id", String(cfg.courseId));
    url.searchParams.set("nb_holes", String(holes));
    // One affiliation id per requested golfer; the API then flags out_of_capacity
    // per slot for that party size.
    for (let i = 0; i < players; i++) {
      url.searchParams.append("affiliation_type_ids[]", String(cfg.affiliationTypeId));
    }

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Referer: bookingUrl(cfg),
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`${course.id}: HTTP ${res.status} from chronogolf`);

    const slots = (await res.json()) as Slot[];
    if (!Array.isArray(slots)) throw new Error(`${course.id}: unexpected chronogolf response`);

    const out: TeeTime[] = [];
    for (const s of slots) {
      if (s.out_of_capacity) continue; // no room for the requested party
      if (!s.start_time) continue;
      const localTime = pad(s.start_time);
      const fee = s.green_fees?.[0]?.green_fee ?? s.green_fees?.[0]?.price ?? null;
      out.push({
        course: course.name,
        courseId: course.id,
        startTime: toIso(date, localTime, course.timezone),
        localTime,
        holes,
        price: fee,
        currency: "CAD",
        playersAvailable: players, // slot fits at least the requested party
        bookingUrl: bookingUrl(cfg),
      });
    }
    return out;
  },
};
