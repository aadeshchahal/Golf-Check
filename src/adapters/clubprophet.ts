import type { Course, CourseAdapter, Holes, TeeTime } from "../types.js";

// Adapter for Club Prophet Systems (CPS / cps.golf) — Country Side (Sherwood Park).
//
// STATUS: NOT WORKING — Country Side ships disabled (enabled:false in the registry).
// The CPS "onlineres" backend IS reachable from a residential IP and issues a
// short-lived anonymous token (POST /identityapi/myconnect/token/short), but its
// data endpoints — OnlineCourses, GetAllOptions, and the tee-time search — sit
// behind a Cloudflare "managed challenge" (challenges.cloudflare.com). Verified
// 2026-06 that the challenge is served to automated requests even with a HEADFUL,
// residential browser (15s+ wait), so the search endpoint/response could never be
// captured. Getting past it would require active bot-detection evasion (solving
// Turnstile, stealth fingerprinting, proxy rotation) — out of scope and against
// this project's good-citizen stance.
//
// Captured so far, in case a reliable + polite path ever appears (e.g. an official
// partner API, or the challenge is relaxed):
//   token:   POST https://countrysideab.cps.golf/identityapi/myconnect/token/short
//   options: GET  .../onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/countrysideab
//   courses: GET  .../onlineres/onlineapi/api/v1/onlinereservation/OnlineCourses
//   (use the bearer token from the token call; the tee-time search endpoint was
//   never reached — Cloudflare-blocked). If solved, implement the flow here and
//   flip the course to enabled:true.

export const clubProphetAdapter: CourseAdapter = {
  async fetchAvailability(course: Course, _date: string, _holes: Holes, _players: number): Promise<TeeTime[]> {
    throw new Error(
      `${course.id}: Club Prophet (CPS) is behind a Cloudflare challenge that blocks ` +
        `automated access — no polite path found, so this course is disabled`,
    );
  },
};
