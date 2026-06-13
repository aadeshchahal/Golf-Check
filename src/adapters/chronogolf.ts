import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { pad, toIso } from "../time.js";

// Adapter for Chronogolf / Lightspeed Golf (Mill Woods, Eagle Rock,
// Country Side, Coloniale).
//
// The public booking widget loads availability from the legacy marketplace
// endpoint:
//
//   GET https://<host>/marketplace/clubs/<clubId>/teetimes
//        ?date=YYYY-MM-DD
//        &course_id=<courseId>
//        &nb_holes=<9|18>
//        &affiliation_type_ids[]=<id>
//
// Response is a JSON array of tee-time objects. The exact field names are
// confirmed during discovery; the mapping below targets the documented legacy
// shape and is intentionally defensive (optional chaining + fallbacks) so a
// minor upstream change degrades a field rather than throwing.

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
};

interface RawGreenFee {
  // legacy widget nests the price under green_fee
  green_fee?: number;
  price?: number;
}

interface RawTeeTime {
  id?: number;
  start_time?: string; // "HH:mm" or "HH:mm:ss"
  date?: string;
  nb_holes?: number;
  // legacy widget returns one green_fee entry per bookable player spot
  green_fees?: RawGreenFee[];
  out_of_capacity?: boolean;
  // some responses expose remaining spots directly
  player_count?: number;
  restrictions?: unknown[];
}

function buildUrl(
  host: string,
  clubId: number,
  courseId: number,
  date: string,
  holes: Holes,
  affiliationTypeIds: number[],
): string {
  const u = new URL(`https://${host}/marketplace/clubs/${clubId}/teetimes`);
  u.searchParams.set("date", date);
  u.searchParams.set("course_id", String(courseId));
  u.searchParams.set("nb_holes", String(holes));
  for (const id of affiliationTypeIds) {
    u.searchParams.append("affiliation_type_ids[]", String(id));
  }
  return u.toString();
}

function bookingUrl(host: string, slug: string, date: string): string {
  return `https://${host}/club/${slug}?date=${date}`;
}

/** Open player spots for a slot. Legacy Chronogolf returns one green_fee per
 *  available spot; fall back to an explicit count if present. */
function spotsAvailable(raw: RawTeeTime): number {
  if (raw.out_of_capacity) return 0;
  if (typeof raw.player_count === "number") return raw.player_count;
  if (Array.isArray(raw.green_fees) && raw.green_fees.length > 0) {
    return Math.min(4, raw.green_fees.length);
  }
  return 0;
}

function lowestPrice(raw: RawTeeTime): number | null {
  const fees = raw.green_fees ?? [];
  const values = fees
    .map((f) => f.green_fee ?? f.price)
    .filter((v): v is number => typeof v === "number");
  return values.length ? Math.min(...values) : null;
}

export const chronogolfAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
    const cfg = course.chronogolf;
    if (!cfg) throw new Error(`${course.id}: missing chronogolf config`);
    if (!cfg.clubId || cfg.courseIdsByHoles[holes].length === 0) {
      throw new Error(
        `${course.id}: needs discovery — run \`npm run discover\` and fill clubId / courseIdsByHoles / affiliationTypeIds in src/courses.ts`,
      );
    }

    const courseIds = cfg.courseIdsByHoles[holes];
    const results: TeeTime[] = [];

    for (const courseId of courseIds) {
      const url = buildUrl(cfg.host, cfg.clubId, courseId, date, holes, cfg.affiliationTypeIds);
      const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Referer: `https://${cfg.host}/` } });
      if (!res.ok) {
        throw new Error(`${course.id}: HTTP ${res.status} from chronogolf`);
      }
      const raw = (await res.json()) as RawTeeTime[];
      for (const slot of raw) {
        if (!slot.start_time) continue;
        const spots = spotsAvailable(slot);
        if (spots <= 0) continue;
        const localTime = pad(slot.start_time);
        results.push({
          course: course.name,
          courseId: course.id,
          startTime: toIso(date, localTime, course.timezone),
          localTime,
          holes,
          price: lowestPrice(slot),
          currency: "CAD",
          playersAvailable: spots,
          bookingUrl: bookingUrl(cfg.host, cfg.slug, date),
        });
      }
    }

    return results;
  },
};
