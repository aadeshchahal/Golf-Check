# Golf-Check

One search across Edmonton-area golf courses. Pick a **date, time (± window),
party size, and 9/18 holes**, and see live availability for all your courses in
one sorted list — instead of opening six booking sites one by one.

Courses in this POC:

| Course | Booking backend |
|---|---|
| Mill Woods | Chronogolf / Lightspeed |
| Eagle Rock | Chronogolf / Lightspeed |
| Country Side (Sherwood Park) | Chronogolf / Lightspeed |
| Coloniale (Beaumont) | Chronogolf / Lightspeed |
| Victoria (City of Edmonton) | PerfectMind / MoveLearnPlay |
| Riverside (City of Edmonton) | PerfectMind / MoveLearnPlay |

## How it works

Rather than driving each website with an AI browser agent at query time (slow,
fragile, expensive), Golf-Check uses a **provider-adapter** design: each course
is mapped once to its booking backend, and an adapter queries that backend's
structured endpoint directly. Four of the six courses share one backend
(Chronogolf), so the whole thing is just **two adapters**.

```
Browser form ──> GET /api/availability ──> aggregate()
                                              ├─ chronogolf adapter  (4 courses)
                                              ├─ perfectmind adapter (2 courses)
                                              ├─ filter: time window + holes + spots
                                              └─ merge + sort -> JSON
```

A backend is required because browsers can't call the booking endpoints directly
(CORS), and the endpoints expect server-side requests. Per-course failures
degrade gracefully — one course erroring never blanks out the rest.

## Setup

```bash
npm install
npx playwright install chromium   # needed for the City (PerfectMind) courses
```

## Step 1 — discover the booking IDs (run once, on your own machine)

Chronogolf and MoveLearnPlay block automated/datacenter traffic, so the IDs
**cannot** be captured from a cloud/CI environment — run discovery on a normal
home machine:

```bash
npm run discover          # or: HEADFUL=1 npm run discover  (to watch the browser)
```

It opens each course's real booking page, captures the availability network
calls, and prints the values to paste into [`src/courses.ts`](src/courses.ts):

- **Chronogolf:** `clubId`, `course_id`(s) per hole count, `affiliation_type_ids`
- **PerfectMind:** the availability XHR URL + a sample of its JSON body
  (use this to confirm the field mapping in
  [`src/adapters/perfectmind.ts`](src/adapters/perfectmind.ts) — the GUIDs are
  already filled in)

Fields left as `0` / `[]` in `src/courses.ts` are placeholders; until filled, a
course shows a clear "needs discovery" message instead of failing silently.

## Step 2 — run

```bash
npm run dev      # http://localhost:3000
```

Open the page, choose date / time / window / players / holes, and search.

## Verifying it's correct

For at least one Chronogolf course (e.g. Coloniale) and one City course (e.g.
Victoria), open the real booking site for the **same date / holes / players** and
confirm the times, prices, and open spots match. Check that 9 vs 18 returns
different inventory, and that asking for 4 players hides slots with only 1–2 open
spots.

## Project layout

```
src/
  types.ts              normalized TeeTime, Query, CourseAdapter interface
  courses.ts            the course registry (backend + ids per course)
  time.ts               Edmonton MDT/MST-aware time helpers
  aggregate.ts          parallel fan-out, filtering, in-memory cache
  server.ts             Fastify: static page + /api/availability
  adapters/
    chronogolf.ts       Mill Woods, Eagle Rock, Country Side, Coloniale
    perfectmind.ts      Victoria, Riverside (Playwright-driven)
scripts/
  discover-ids.ts       one-time id/endpoint capture
public/
  index.html, app.js    the UI
```

## Notes & limits

- **Personal, low-volume use.** Results are cached (~3 min). Don't hammer the
  endpoints; no automated booking.
- These are undocumented public-widget endpoints. Each adapter is isolated, so a
  single upstream change only touches one file.
- Out of scope (easy follow-ons): booking/checkout, accounts, push alerts when a
  desired slot opens, more courses, and GolfNow/Supreme Golf integration.
- If you ever turn this into a product for other golfers, switch to official
  partner APIs (GolfNow Affiliate API, Lightspeed Partner API) for ToS
  compliance.

## Tech

Node 20+ · TypeScript · Fastify · Playwright (for the PerfectMind courses).
