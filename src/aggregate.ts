import type { Course, CourseAdapter, CourseResult, Holes, Query, TeeTime } from "./types.js";
import { enabledCourses } from "./courses.js";
import { foreUpAdapter } from "./adapters/foreup.js";
import { teeOnAdapter } from "./adapters/teeon.js";
import { perfectMindAdapter } from "./adapters/perfectmind.js";
import { minutesOfDay } from "./time.js";

const ADAPTERS: Record<Course["backend"], CourseAdapter> = {
  foreup: foreUpAdapter,
  teeon: teeOnAdapter,
  perfectmind: perfectMindAdapter,
};

// --- tiny in-memory cache (per course + date + holes) ---------------------
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
interface CacheEntry {
  expires: number;
  value: TeeTime[];
}
const cache = new Map<string, CacheEntry>();

// Party size is part of the key because some backends (Tee-On) filter the tee
// sheet by it upstream, so results genuinely differ per player count.
function cacheKey(courseId: string, date: string, holes: Holes, players: number): string {
  return `${courseId}:${date}:${holes}:${players}`;
}

async function fetchCourse(course: Course, date: string, holes: Holes, players: number): Promise<TeeTime[]> {
  const key = cacheKey(course.id, date, holes, players);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const adapter = ADAPTERS[course.backend];
  const value = await adapter.fetchAvailability(course, date, holes, players);
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** Keep tee times within [time - window, time + window] and with enough spots. */
function withinQuery(t: TeeTime, q: Query): boolean {
  if (t.playersAvailable < q.players) return false;
  if (t.holes !== q.holes) return false;
  const target = minutesOfDay(q.time);
  const slot = minutesOfDay(t.localTime);
  return Math.abs(slot - target) <= q.windowMinutes;
}

/** Query every enabled course in parallel and return per-course results.
 *  A failure in one course never affects the others. */
export async function aggregate(q: Query): Promise<CourseResult[]> {
  const courses = enabledCourses();
  const settled = await Promise.allSettled(
    courses.map((c) => fetchCourse(c, q.date, q.holes, q.players)),
  );

  return courses.map((course, i): CourseResult => {
    const r = settled[i];
    if (r.status === "fulfilled") {
      const teeTimes = r.value
        .filter((t) => withinQuery(t, q))
        .sort((a, b) => a.localTime.localeCompare(b.localTime));
      return { courseId: course.id, course: course.name, ok: true, teeTimes };
    }
    return {
      courseId: course.id,
      course: course.name,
      ok: false,
      teeTimes: [],
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });
}

/** Query every enabled course in parallel and return per-course results via callback.
 *  A failure in one course never affects the others. */
export async function streamAggregate(q: Query, onResult: (r: CourseResult) => void): Promise<void> {
  const courses = enabledCourses();
  const promises = courses.map(async (course) => {
    try {
      const value = await fetchCourse(course, q.date, q.holes, q.players);
      const teeTimes = value
        .filter((t) => withinQuery(t, q))
        .sort((a, b) => a.localTime.localeCompare(b.localTime));
      onResult({ courseId: course.id, course: course.name, ok: true, teeTimes });
    } catch (e) {
      onResult({
        courseId: course.id,
        course: course.name,
        ok: false,
        teeTimes: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  await Promise.allSettled(promises);
}

/** Flatten + sort all successful tee times across courses by time. */
export function flatten(results: CourseResult[]): TeeTime[] {
  return results
    .flatMap((r) => r.teeTimes)
    .sort((a, b) => a.localTime.localeCompare(b.localTime) || a.course.localeCompare(b.course));
}
