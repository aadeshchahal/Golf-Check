// Core domain types for the tee-time aggregator.

/** Which booking backend a course runs on. Each Edmonton-area course migrated
 *  to a different system; see src/courses.ts for the mapping. */
export type Backend = "foreup" | "teeon" | "perfectmind" | "teeitup";

/** Number of holes a golfer wants to play. */
export type Holes = 9 | 18;

/** A normalized, backend-agnostic tee time. Every adapter maps its upstream
 *  response into this shape so the rest of the app never cares about provider
 *  details. */
export interface TeeTime {
  /** Display name of the course, e.g. "Coloniale". */
  course: string;
  /** Course id from the registry (stable key). */
  courseId: string;
  /** Local start time as ISO 8601, e.g. "2026-06-20T07:10:00-06:00". */
  startTime: string;
  /** "HH:mm" in the course's local time, convenient for display/sorting. */
  localTime: string;
  /** 9 or 18. */
  holes: Holes;
  /** Lowest green fee for the slot, in dollars. null if unknown. */
  price: number | null;
  currency: string;
  /** How many player spots are open on this tee time (1-4). */
  playersAvailable: number;
  /** Deep link to the real booking page for this slot/date. */
  bookingUrl: string;
}

/** A parsed, validated user query. */
export interface Query {
  /** "YYYY-MM-DD" in the course local date. */
  date: string;
  /** Target "HH:mm" the golfer wants to play around. */
  time: string;
  /** +/- minutes around `time` to include. e.g. 90 => time-90 .. time+90. */
  windowMinutes: number;
  /** Minimum open player spots required (1-4). */
  players: number;
  holes: Holes;
  /** Restrict the search to these course ids. Empty/undefined = all enabled. */
  courseIds?: string[];
}

/** Per-course aggregation result, including failures so the UI can show which
 *  courses errored instead of silently dropping them. */
export interface CourseResult {
  courseId: string;
  course: string;
  ok: boolean;
  teeTimes: TeeTime[];
  error?: string;
}

/** Every backend adapter implements this. `fetchAvailability` returns the tee
 *  times for the given date + hole count for one course; filtering by time
 *  window happens later in aggregation.
 *
 *  `players` is passed through because some backends (Tee-On) filter the tee
 *  sheet by party size upstream rather than reporting a per-slot open-spot
 *  count. Backends that DO report open spots (ForeUp, PerfectMind) query their
 *  full sheet and set `playersAvailable` accurately; the aggregator still
 *  filters by party size defensively. */
export interface CourseAdapter {
  fetchAvailability(course: Course, date: string, holes: Holes, players: number): Promise<TeeTime[]>;
}

/** Registry entry describing one bookable course. */
export interface Course {
  /** Stable internal id used in URLs/caching. */
  id: string;
  /** Display name. */
  name: string;
  backend: Backend;
  /** IANA timezone; all Edmonton-area courses are America/Edmonton. */
  timezone: string;
  /** Whether the course is queried by the aggregator. */
  enabled: boolean;
  /** Backend-specific configuration (ids, codes, guids). */
  foreup?: ForeUpConfig;
  teeon?: TeeOnConfig;
  perfectmind?: PerfectMindConfig;
  teeitup?: TeeItUpConfig;
}

/** TeeItUp / GolfNow (Kenna backend) — River Ridge. Public JSON booking API,
 *  no auth or browser; the subdomain alias rides along as an `x-be-alias` header. */
export interface TeeItUpConfig {
  /** GolfNow/Kenna facility id, e.g. 17149. */
  facilityId: number;
  /** Booking subdomain alias used as the x-be-alias header, e.g. "river-ridge". */
  alias: string;
}

/** ForeUp Software (foreupsoftware.com) — Eagle Rock. Public JSON booking API. */
export interface ForeUpConfig {
  /** Numeric course id in the booking URL, e.g. 18992. */
  courseId: number;
  /** Public booking class (rate group) id, e.g. 384. */
  bookingClass: number;
  /** Tee sheet / schedule id, e.g. 916. */
  scheduleId: number;
}

/** Tee-On Golf Systems (tee-on.com) — Mill Woods, Coloniale. Server-rendered
 *  tee sheet driven through a real browser; results filtered by party size. */
export interface TeeOnConfig {
  /** 4-letter course code, e.g. "MILL" / "COGO". */
  courseCode: string;
  /** Numeric course group id shared by a Tee-On operator, e.g. 10342. */
  courseGroupId: number;
  /** Some Tee-On courses (e.g. Lewis Estates) run a CSS-driven "wait timer"
   *  overlay and only render tee-time cards with stylesheets enabled. Set this
   *  so the adapter keeps CSS and rides out the overlay (~30s) — slower, but it
   *  returns data instead of silently finding 0 cards. */
  allowStyles?: boolean;
}

/** PerfectMind / Xplor "MoveLearnPlay" — City of Edmonton (Victoria, Riverside).
 *  Booking sits behind a virtual-queue and is driven through a real browser. */
export interface PerfectMindConfig {
  /** Host, e.g. "movelearnplay.edmonton.ca". */
  host: string;
  /** Path prefix, e.g. "/COE/public". */
  basePath: string;
  /** Golf category GUID used to enter the booking queue. */
  categoryGuid: string;
  /** Course GUID used in the public golf course URL + search form. */
  guid: string;
}
