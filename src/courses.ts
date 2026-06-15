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
// Country Side (Sherwood Park) is present but DISABLED (enabled:false): it runs
// on Club Prophet Systems (countrysideab.cps.golf), whose data APIs sit behind a
// Cloudflare challenge that blocks automated access even headful/residential
// (verified 2026-06). See src/adapters/clubprophet.ts. Revisit only if a
// reliable, polite path is found.

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
  // Tee-On courses (same backend as Mill Woods/Coloniale). Codes + group ids
  // captured 2026-06 from each course's own "Book Now" → tee-on.com link.
  {
    id: "lewisestates",
    name: "Lewis Estates",
    backend: "teeon",
    timezone: "America/Edmonton",
    enabled: true,
    teeon: {
      courseCode: "LEGC",
      courseGroupId: 10032,
      allowStyles: true, // CSS-gated wait-timer course; ~30s but returns data
    },
  },
  {
    id: "legends",
    name: "The Legends (Sherwood Park)",
    backend: "teeon",
    timezone: "America/Edmonton",
    enabled: true,
    teeon: {
      courseCode: "LEGE",
      courseGroupId: 11941,
    },
  },
  {
    id: "jagareridge",
    name: "Jagare Ridge",
    backend: "teeon",
    timezone: "America/Edmonton",
    enabled: true,
    teeon: {
      courseCode: "JAGA",
      courseGroupId: 10137,
    },
  },
  // TeeItUp / GolfNow (Kenna). Facility id + subdomain alias captured 2026-06
  // from river-ridge.book.teeitup.com (public JSON API, no browser needed).
  {
    id: "riverridge",
    name: "River Ridge",
    backend: "teeitup",
    timezone: "America/Edmonton",
    enabled: true,
    teeitup: {
      facilityId: 17149,
      alias: "river-ridge",
    },
  },
  // Chronogolf / Lightspeed. club/course/public-affiliation ids captured 2026-06
  // from the booking widget (public JSON API, no browser needed).
  {
    id: "broadmoor",
    name: "Broadmoor (Sherwood Park)",
    backend: "chronogolf",
    timezone: "America/Edmonton",
    enabled: true,
    chronogolf: {
      host: "www.chronogolf.ca",
      clubId: 18170,
      courseId: 21206,
      affiliationTypeId: 85414, // "Public"
      slug: "broadmoor-public-golf-course-2",
    },
  },
  // Club Prophet (CPS). DISABLED — data APIs are Cloudflare-blocked even
  // headful/residential (see clubprophet.ts). Kept here so the intent + recon
  // are recorded; never queried while enabled:false.
  {
    id: "countryside",
    name: "Country Side (Sherwood Park)",
    backend: "clubprophet",
    timezone: "America/Edmonton",
    enabled: false,
    clubprophet: {
      host: "countrysideab.cps.golf",
      tenant: "countrysideab",
    },
  },
];

export function enabledCourses(): Course[] {
  return COURSES.filter((c) => c.enabled);
}

export function getCourse(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}
