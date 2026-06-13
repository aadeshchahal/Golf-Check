// Core domain types for the tee-time aggregator.

/** Which booking backend a course runs on. */
export type Backend = "chronogolf" | "perfectmind";

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

/** Every backend adapter implements this. `fetchAvailability` returns ALL tee
 *  times for the given date + hole count for one course; filtering by time
 *  window and party size happens later in aggregation. */
export interface CourseAdapter {
  /** Fetch raw availability for one course on one date for a hole count. */
  fetchAvailability(course: Course, date: string, holes: Holes): Promise<TeeTime[]>;
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
  /** Backend-specific configuration (ids, slugs, guids). */
  chronogolf?: ChronogolfConfig;
  perfectmind?: PerfectMindConfig;
}

export interface ChronogolfConfig {
  /** Public widget host, e.g. "www.chronogolf.com" or "www.chronogolf.ca". */
  host: string;
  /** Human-readable slug for building booking links. */
  slug: string;
  /** Numeric club id (from discovery). */
  clubId: number;
  /** Numeric course id per hole count. A club may expose separate course ids
   *  for its 9- vs 18-hole layouts (and multiple nines). Map each requested
   *  hole count to the course id(s) that should be queried. */
  courseIdsByHoles: Record<Holes, number[]>;
  /** Affiliation/rate type ids identifying the public rate (from discovery). */
  affiliationTypeIds: number[];
}

export interface PerfectMindConfig {
  /** Host, e.g. "movelearnplay.edmonton.ca". */
  host: string;
  /** Path prefix, e.g. "/COE/public". */
  basePath: string;
  /** Course GUID used in the public golf course URL. */
  guid: string;
}
