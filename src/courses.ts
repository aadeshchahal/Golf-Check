import type { Course } from "./types.js";

// The six Edmonton-area courses for the POC.
//
// Two pieces of config must be captured once with `npm run discover` on a
// machine with normal internet access (Chronogolf + MoveLearnPlay block
// automated/datacenter traffic, so this cannot run from a CI/cloud sandbox):
//
//   Chronogolf  -> clubId, courseIdsByHoles, affiliationTypeIds
//   PerfectMind -> the availability XHR shape (GUIDs below are already known)
//
// Fields left as 0 / [] are placeholders. Until they are filled the course
// will surface a clear "needs discovery" error in the UI rather than fail
// silently. Run discovery, paste the values here, restart the server.

export const COURSES: Course[] = [
  {
    id: "millwoods",
    name: "Mill Woods",
    backend: "chronogolf",
    timezone: "America/Edmonton",
    enabled: true,
    chronogolf: {
      host: "www.chronogolf.com",
      slug: "mill-woods-golf-club",
      clubId: 0, // TODO discovery
      courseIdsByHoles: { 9: [], 18: [] }, // TODO discovery
      affiliationTypeIds: [], // TODO discovery
    },
  },
  {
    id: "eaglerock",
    name: "Eagle Rock",
    backend: "chronogolf",
    timezone: "America/Edmonton",
    enabled: true,
    chronogolf: {
      host: "www.chronogolf.com",
      slug: "eagle-rock-golf-course",
      clubId: 0, // TODO discovery
      courseIdsByHoles: { 9: [], 18: [] }, // TODO discovery
      affiliationTypeIds: [], // TODO discovery
    },
  },
  {
    id: "countryside",
    name: "Country Side (Sherwood Park)",
    backend: "chronogolf",
    timezone: "America/Edmonton",
    enabled: true,
    chronogolf: {
      host: "www.chronogolf.ca",
      slug: "country-side-golf-club",
      clubId: 0, // TODO discovery
      // 27+ holes: expect several course ids; group them by the hole count a
      // golfer would book. Discovery will list every course id under the club.
      courseIdsByHoles: { 9: [], 18: [] }, // TODO discovery
      affiliationTypeIds: [], // TODO discovery
    },
  },
  {
    id: "coloniale",
    name: "Coloniale (Beaumont)",
    backend: "chronogolf",
    timezone: "America/Edmonton",
    enabled: true,
    chronogolf: {
      host: "www.chronogolf.ca",
      slug: "coloniale-golf-country-club",
      clubId: 0, // TODO discovery
      courseIdsByHoles: { 9: [], 18: [] }, // TODO discovery
      affiliationTypeIds: [], // TODO discovery
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
      guid: "2b613d0a-e225-4588-9d24-a741b0118433", // known
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
      guid: "303ad9dc-752c-4ce7-9029-f9b0be4ae9c0", // known
    },
  },
];

export function enabledCourses(): Course[] {
  return COURSES.filter((c) => c.enabled);
}

export function getCourse(id: string): Course | undefined {
  return COURSES.find((c) => c.id === id);
}
