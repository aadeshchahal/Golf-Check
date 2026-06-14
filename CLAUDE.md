# CLAUDE.md — Golf-Check

Context for any Claude Code session working on this repo. Read this first.

## What this project is

A personal tee-time aggregator: one web page to search live availability across
Edmonton-area golf courses by **date, time (± window), party size (1–4), and
9 or 18 holes** — instead of checking each booking site by hand.

It is a **personal-use proof-of-concept**, not a commercial product. We query the
same public booking endpoints the courses' own "Book Now" pages use, at low
volume, with caching. No official partner API credentials. No auto-booking.

## Architecture (provider-adapter — NOT runtime AI browsing)

Each course is mapped once to its real booking backend; an adapter queries that
backend and normalizes to the `TeeTime` shape. **Each course migrated to a
different system** — the old "everyone's on Chronogolf" assumption was wrong (the
Chronogolf listings are stale, unclaimed directory pages). Verified 2026-06.

```
public/index.html + app.js  (form: date/time/window/players/holes)
        └─ GET /api/availability        src/server.ts (Fastify)
              └─ aggregate()             src/aggregate.ts
                   ├─ foreup adapter      src/adapters/foreup.ts   (plain JSON fetch)
                   │     Eagle Rock
                   ├─ teeon adapter       src/adapters/teeon.ts    (Playwright + HTML scrape)
                   │     Mill Woods, Coloniale
                   ├─ perfectmind adapter src/adapters/perfectmind.ts (Playwright; virtual queue)
                   │     Victoria, Riverside
                   ├─ filter: time window + holes + open spots (party size)
                   ├─ in-memory cache (~3 min; party size in key only for Tee-On,
                   │   which filters upstream — ForeUp/PerfectMind share across sizes)
                   └─ Promise.allSettled: one course failing never blanks others
```

Key files: `src/types.ts` (TeeTime/Query/CourseAdapter + per-backend configs),
`src/courses.ts` (registry: which backend + ids/codes/guids per course),
`src/time.ts` (Edmonton MDT/MST offset math), `src/browser.ts` (shared
lazy-singleton Chromium for the two browser-driven adapters; aborts
image/media/font/stylesheet requests since we only parse HTML, and exposes
`warmBrowser()` which the server calls after `listen` to pre-launch Chromium).

## Backends (captured ids live in src/courses.ts)

- **ForeUp** — Eagle Rock. Public JSON, no auth, no browser:
  `GET foreupsoftware.com/index.php/api/booking/times?...&booking_class=&schedule_id=`.
  Open spots + green fee come split by hole count (`available_spots_18`/`green_fee_9`…).
- **Tee-On** — Mill Woods, Coloniale. No JSON API; drive a browser:
  `ComboLanding?CourseCode=` → `WebBookingSearchSteps` form (Date/Holes/Players) →
  POST `WebBookingSearchResults`. Parse `.search-results-tee-times-box`; each card's
  `onclick="isNotLocked(code,side,date,time,holes,spots,…)"` gives spots, `.price`
  the fee. Tee-On **filters the sheet by party size upstream** (so the adapter takes
  `players`), only offers a short booking window (Coloniale ~4 days; out-of-window
  dates surface a per-course error), and blocks single-golfer empty-slot bookings
  (so `players=1` legitimately returns few/none at these courses).
- **PerfectMind / MoveLearnPlay** — Victoria, Riverside (City of Edmonton). Booking
  sits behind a **virtual queue** (`golf/sendtoqueue` → `/queue/wait`, released in
  ~seconds off-peak). After release we POST `golf/TeeTimeSearch` with the page's
  `__RequestVerificationToken`; the HTML response has one `button[data-time]`
  `[data-spaces]` per slot. No price exposed here (City fees are fixed) → price null.

## Current state

- **Working end-to-end for 5 courses** (Eagle Rock, Mill Woods, Coloniale, Victoria,
  Riverside). Builds, typechecks, runs; live results, filtering, caching, and
  per-course error isolation all verified against the real sites (2026-06).
- **UI & Performance:** The frontend is mobile-responsive (stacking table cards on narrow screens), and search results are streamed to the client incrementally via Server-Sent Events (SSE) as each course finishes, preventing long loading screens.
- **Course selector:** the form has a per-course toggle (an "All" chip + one chip per course), defaulting to none selected. The selected ids ride along as a `courses=` param; `GET /api/courses` feeds the chips from `src/courses.ts` (single source of truth). Skipping the City courses avoids their slow virtual queue.
- **Search speed (2026-06):** the browser adapters wait on the actual data selector instead of `networkidle`/`waitForURL` timeouts, which cut Tee-On from ~65s to ~5s. Eagle Rock (ForeUp) is ~1s. The City (PerfectMind) courses are still bounded by the virtual queue (~30–48s cold, load-dependent) — that wait is the floor until/unless a background queue pre-warm is added (see Out of scope).
- **Country Side (Sherwood Park) is intentionally omitted.** It runs on Club Prophet
  Systems (`countrysideab.cps.golf`), a clean JSON API but **behind a Cloudflare bot
  challenge** that 403s automated/headless requests. Revisit only if a reliable,
  polite path is found (untested: a real headful/residential browser may clear it).

## Running it

```bash
npm install
npx playwright install chromium   # needed for teeon + perfectmind adapters
npm run dev                       # http://localhost:3000
npm run typecheck
```

Chromium is pre-warmed at startup, so the first search no longer pays the launch
cost. ForeUp (~1s) and Tee-On (~5s) are fast; the City (PerfectMind) courses still
wait out their virtual queue on a cold fetch (~30–48s, load-dependent). Subsequent
calls hit the 3-min cache — and because the cache is shared across party size for
ForeUp/PerfectMind, changing only the player count returns near-instantly.

### Hosting & Sharing (Crucial Context)
We attempted to host this on Google Cloud Run and Vercel, but both failed. The golf courses (especially PerfectMind and Tee-On) use aggressive Cloudflare Bot Protection that instantly blocks known Datacenter IPs. Playwright also struggles with memory/bundle-size limits on serverless platforms.
**Resolution:** To share this with friends, the project must run on a residential IP (your laptop). Start the dev server (`npm run dev`), then use a secure tunnel like Ngrok (`npx ngrok http 3000`) to generate a public link. *Avoid `localtunnel` as it publicly exposes your home IP address on its warning screen.*

## Verifying correctness

For one course per backend, open the real booking site for the **same date / holes /
players** and confirm times, prices, and open spots match: Eagle Rock (ForeUp), Mill
Woods or Coloniale (Tee-On), Victoria or Riverside (PerfectMind). Confirm 9 vs 18
returns different inventory/prices, and that a larger party hides slots without room.
Remember Coloniale's short booking window and Tee-On's singles rule when results look
sparse — those are real, not bugs.

## Conventions / gotchas

- TypeScript, ESM (`"type": "module"`), run via `tsx` (no build step).
- All courses are `America/Edmonton`; use the helpers in `src/time.ts`, don't
  hard-code the UTC offset (it changes with DST). PerfectMind's `SearchDate` is local
  midnight expressed in UTC — derived from `zoneOffset`, not hard-coded.
- Adapters are isolated on purpose: a single upstream change should only touch one
  file. Normalize everything to the `TeeTime` shape in `src/types.ts`.
- `page.evaluate` callbacks are passed as **strings** in the browser-driven adapters:
  tsx/esbuild otherwise injects a `__name` helper that isn't defined in the page and
  throws `ReferenceError: __name`.
- **Don't wait on `networkidle`** for these legacy/queue sites — they keep connections
  open, so it burns the full timeout. Wait on the actual element you need
  (`page.waitForSelector(...)`) or the destination URL (`page.waitForURL(...)`) instead.
  Gotos use `domcontentloaded`, not `networkidle`.
- The cache key in `aggregate.ts` is **backend-aware**: party size is part of it only
  for Tee-On (which filters the sheet upstream). ForeUp/PerfectMind fetch the whole
  sheet and we filter spots in `withinQuery`, so they share one entry across party
  sizes — keep that invariant if you touch caching or the open-spots filter.
- Be a good citizen: results are cached; don't hammer endpoints; no auto-booking.
- A course backend being unreachable surfaces as a per-course error in the response
  (`ok:false`), never a blank page — see `Promise.allSettled` in `aggregate.ts`.

## Out of scope (easy follow-ons)

Country Side / Prophet (Cloudflare), booking/checkout, accounts, push alerts when a
desired slot opens, more courses, GolfNow/Supreme Golf integration. If this ever
becomes a product for other golfers, switch to official partner APIs.

**Background PerfectMind queue pre-warm (the remaining City-course speed lever).**
The ~30–48s on Victoria/Riverside is the City's virtual queue. A warm-pool that holds
an already-released session (cookies + `__RequestVerificationToken`) per City course,
refreshed on a background timer, would let user searches POST `TeeTimeSearch` directly
and skip the queue (dropping them to ~1–3s, like Tee-On). Deliberately not built: it
shifts the server from polite on-demand querying to **proactively holding a queue slot**
even when nobody's searching, and adds token-expiry/refresh/fallback complexity.
Before building, first **measure how long a released session stays valid** (that sets
the refresh cadence and how impolite it is). Should be an opt-in flag, default off.
