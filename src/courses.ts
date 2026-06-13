import type { Course } from "./types.js";

// The Edmonton-area courses for the POC.
//
// IMPORTANT: despite their stale Chronogolf marketplace listings, these courses
// each book through a *different* live system (verified 2026-06 against each
// course's own "Book Now" link). The ids/codes/guids below were captured from
// those live booking flows:
//
//   ForeUp (JSON API)      -> Eagle Rock
//   Tee-On (browser/HTML)  -> Mill Woods, Coloniale
//   PerfectMind (browser)  -> Victoria, Riverside  (City of Edmonton)
//
// Country Side (Sherwood Park) is intentionally omitted: it runs on Club
// Prophet Systems (countrysideab.cps.golf), whose availability API sits behind
// a Cloudflare bot challenge that blocks automated/headless access. Revisit if
// a reliable, polite path is found.

export const COURSES: Course[] = [
  {
    id: "eaglerock",
    name: "Eagle Rock",
    backend: "foreup",
    timezone: "America/Edmonton",
    enabled: true,
    foreup: {
      courseId: 18992,
      bookingClass: 384, // Public
      scheduleId: 916,
    },
  },
  {
    id: "millwoods",
    name: "Mill Woods",
    backend: "teeon",
    timezone: "America/Edmonton",
    enabled: true,
    teeon: {
      courseCode: "MILL",
      courseGroupId: 10342,
    },
  },
  {
    id: "coloniale",
    name: "Coloniale (Beaumont)",
    backend: "teeon",
    timezone: "America/Edmonton",
    enabled: true,
    teeon: {
      courseCode: "COGO",
      courseGroupId: 10342,
    },
  },
  {
    id: "victoria",
    name: "Victoria (City of Edmonton)",
    backend: "perfectmind",
    timezone: "America/Edmonton",
    enabled: true,
    perfectmind: {
      host: "movelearnplay.edmonton.ca",
      basePath: "/COE/public",
      categoryGuid: "2b251ce6-ea3d-45a1-9586-53d4054db7f2",
      guid: "2b613d0a-e225-4588-9d24-a741b0118433",
    },
  },
  {
    id: "riverside",
    name: "Riverside (City of Edmonton)",
    backend: "perfectmind",
    timezone: "America/Edmonton",
    enabled: true,
    perfectmind: {
      host: "movelearnplay.edmonton.ca",
      basePath: "/COE/public",
      categoryGuid: "2b251ce6-ea3d-45a1-9586-53d4054db7f2",
      guid: "303ad9dc-752c-4ce7-9029-f9b0be4ae9c0",
    },
  },
];

export function enabledCourses(): Course[] {
  return COURSES.filter((c) => c.enabled);
}

export function getCourse(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}
