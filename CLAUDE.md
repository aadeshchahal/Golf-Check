# CLAUDE.md — Golf-Check

Context for any Claude Code session working on this repo. Read this first.

## What this project is

A personal tee-time aggregator: one web page to search live availability across
six Edmonton-area golf courses by **date, time (± window), party size (1–4), and
9 or 18 holes** — instead of checking six booking sites by hand.

It is a **personal-use proof-of-concept**, not a commercial product. We query the
same public booking endpoints the courses' own "Book Now" pages use, at low
volume, with caching. No official partner API credentials.

## Architecture (provider-adapter — NOT runtime AI browsing)

Each course is mapped once to its booking backend; an adapter queries that
backend directly. Four of six courses share one backend.

```
public/index.html + app.js  (form: date/time/window/players/holes)
        └─ GET /api/availability        src/server.ts (Fastify)
              └─ aggregate()             src/aggregate.ts
                   ├─ chronogolf adapter  src/adapters/chronogolf.ts
                   │     Mill Woods, Eagle Rock, Country Side, Coloniale
                   ├─ perfectmind adapter src/adapters/perfectmind.ts (Playwright)
                   │     Victoria, Riverside
                   ├─ filter: time window + holes + open spots
                   ├─ in-memory cache (~3 min)
                   └─ Promise.allSettled: one course failing never blanks others
```

Key files: `src/types.ts` (TeeTime/Query/CourseAdapter), `src/courses.ts` (the
registry of ids per course), `src/time.ts` (Edmonton MDT/MST math),
`scripts/discover-ids.ts` (one-time id capture).

## Current state

- Full app builds, typechecks, and runs. Server + API + UI + filtering + caching
  + graceful per-course errors all verified.
- **What is NOT done:** the live booking ids were never captured, because the
  environment where the code was written (a cloud sandbox) has a locked-down
  network and the booking sites (Chronogolf, MoveLearnPlay) block datacenter
  traffic. They must be captured on a machine with normal internet — i.e. here.

## What to do next (run these on this machine)

1. Install deps and the browser:
   ```bash
   npm install
   npx playwright install chromium
   ```
2. Capture the ids (headful so you can solve any anti-bot challenge / click a
   date in the widget if needed):
   ```bash
   HEADFUL=1 npm run discover
   ```
3. **Chronogolf (4 courses):** paste the printed `clubId`, `course_id`(s) per
   hole count, and `affiliation_type_ids` into the matching entries in
   `src/courses.ts`. Fields currently `0` / `[]` are placeholders.
4. **PerfectMind (Victoria, Riverside):** discovery prints the availability JSON
   it captured. The field mapping in `src/adapters/perfectmind.ts` is a
   best-guess marked `NEEDS-VERIFICATION` — update `extractTime` / `extractSpots`
   / `mapSlot` and `looksLikeAvailability` to match the real field names and the
   real XHR URL. The course GUIDs are already filled in.
5. Run it:
   ```bash
   npm run dev      # http://localhost:3000
   ```

## Verifying correctness

For one Chronogolf course (e.g. Coloniale) and one City course (e.g. Victoria),
open the real booking site for the **same date / holes / players** and confirm
times, prices, and open spots match. Confirm 9 vs 18 returns different inventory,
and that asking for 4 players hides slots with only 1–2 open spots.

## Conventions / gotchas

- TypeScript, ESM (`"type": "module"`), run via `tsx` (no build step).
- All courses are `America/Edmonton`; use the helpers in `src/time.ts`, don't
  hard-code the UTC offset (it changes with DST).
- Adapters are isolated on purpose: a single upstream change should only touch
  one file. Normalize everything to the `TeeTime` shape in `src/types.ts`.
- Be a good citizen: results are cached; don't hammer endpoints; no auto-booking.
- The placeholder-id guard in `chronogolf.ts` throws a "needs discovery" message
  — that's expected until step 3 is done, and it surfaces in the UI per course.

## Out of scope (easy follow-ons)

Booking/checkout, accounts, push alerts when a desired slot opens, more courses,
GolfNow/Supreme Golf integration. If this ever becomes a product for other
golfers, switch to official partner APIs (GolfNow Affiliate, Lightspeed Partner).
