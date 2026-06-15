import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";
import { toIso } from "../time.js";

// Adapter for TeeItUp / GolfNow (Kenna backend) — River Ridge.
//
// The booking widget (river-ridge.book.teeitup.com) reads a public JSON API; no
// auth or browser is needed, just an `x-be-alias` header naming the subdomain:
//
//   GET https://phx-api-be-east-1b.kenna.io/v2/tee-times
//        ?date=YYYY-MM-DD&facilityIds=<id>&returnPromotedRates=true
//        (header) x-be-alias: <alias>
//
// Response is an array (one block per facility); each block has a `teetimes[]`.
// Each slot carries a UTC `teetime`, `minPlayers`/`maxPlayers`/`bookedPlayers`
// (open spots = max - booked), and `rates[]` split by hole count with green fees
// in **cents** (`greenFeeCart`, plus an optional discounted `promotion.greenFeeCart`).

const API_HOST = "https://phx-api-be-east-1b.kenna.io";

interface Rate {
  holes?: number;
  greenFeeCart?: number; // cents
  promotion?: { greenFeeCart?: number } | null;
}
interface Slot {
  teetime?: string; // "2026-06-16T12:27:00.000Z" (UTC)
  rates?: Rate[];
  bookedPlayers?: number;
  maxPlayers?: number;
}
interface FacilityBlock {
  teetimes?: Slot[];
}

/** Convert a UTC instant to "HH:mm" in the course's local zone (DST-safe). */
function localHm(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function bookingUrl(cfg: NonNullable<Course["teeitup"]>): string {
  return `https://${cfg.alias}.book.teeitup.com/?course=${cfg.facilityId}`;
}

export const teeItUpAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]> {
    const cfg = course.teeitup;
    if (!cfg) throw new Error(`${course.id}: missing teeitup config`);

    const url = `${API_HOST}/v2/tee-times?date=${date}&facilityIds=${cfg.facilityId}&returnPromotedRates=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "x-be-alias": cfg.alias },
    });
    if (!res.ok) throw new Error(`${course.id}: HTTP ${res.status} from teeitup`);

    const data = (await res.json()) as FacilityBlock[];
    const slots = Array.isArray(data) ? data.flatMap((b) => b.teetimes ?? []) : [];

    const out: TeeTime[] = [];
    for (const s of slots) {
      if (!s.teetime) continue;
      const rates = (s.rates ?? []).filter((r) => r.holes === holes);
      if (rates.length === 0) continue;

      const open = Math.max(0, Math.min(4, (s.maxPlayers ?? 0) - (s.bookedPlayers ?? 0)));
      if (open <= 0) continue;

      // Lowest fee for the requested hole count (prefer the discounted rate).
      const cents = Math.min(
        ...rates.map((r) => r.promotion?.greenFeeCart ?? r.greenFeeCart ?? Infinity),
      );
      const localTime = localHm(s.teetime, course.timezone);

      out.push({
        course: course.name,
        courseId: course.id,
        startTime: toIso(date, localTime, course.timezone),
        localTime,
        holes,
        price: Number.isFinite(cents) ? cents / 100 : null,
        currency: "CAD",
        playersAvailable: open,
        bookingUrl: bookingUrl(cfg),
      });
    }
    return out;
  },
};
