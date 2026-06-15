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
backend and normalizes to the `TeeTime` shape. **Each course's own "Book Now"
link is the source of truth** — third-party listings (GolfNow, GolfLink, and
Chronogolf's *directory* pages) are often stale/misleading; always check the
course's own site. Six booking backends in play (verified 2026-06):

```
public/index.html + app.js  (form: date/time/window/players/holes)
        └─ GET /api/availability        src/server.ts (Fastify)
              └─ aggregate()             src/aggregate.ts
                   ├─ foreup adapter      src/adapters/foreup.ts   (plain JSON fetch)
                   │     Eagle Rock
                   ├─ teeon adapter       src/adapters/teeon.ts    (Playwright + HTML scrape)
                   │     Mill Woods, Coloniale, Lewis Estates, The Legends, Jagare Ridge
                   ├─ perfectmind adapter src/adapters/perfectmind.ts (Playwright; virtual queue)
                   │     Victoria, Riverside
                   ├─ teeitup adapter     src/adapters/teeitup.ts  (plain JSON fetch)
                   │     River Ridge
                   ├─ chronogolf adapter  src/adapters/chronogolf.ts (plain JSON fetch)
                   │     Broadmoor
                   ├─ clubprophet adapter src/adapters/clubprophet.ts (DISABLED — Cloudflare)
                   │     Country Side
                   ├─ filter: time window + holes + open spots (party size)
                   ├─ in-memory cache (~3 min; party size in key for Tee-On + Chronogolf,
                   │   which filter upstream — ForeUp/PerfectMind/TeeItUp share across sizes)
                   └─ Promise.allSettled: one course failing never blanks others
```

Key files: `src/types.ts` (TeeTime/Query/CourseAdapter + per-backend configs),
`src/courses.ts` (registry: which backend + ids/codes/guids per course),
`src/time.ts` (Edmonton MDT/MST offset math), `src/browser.ts` (shared
lazy-singleton Chromium for the browser-driven adapters; aborts image/media/font
requests since we only parse HTML — but **not** stylesheet, which some Tee-On
pages need to render cards, hence the per-course `allowStyles` opt-out — and
exposes `warmBrowser()` which the server calls after `listen` to pre-launch
Chromium).

## Backends (captured ids live in src/courses.ts)

- **ForeUp** — Eagle Rock. Public JSON, no auth, no browser:
  `GET foreupsoftware.com/index.php/api/booking/times?...&booking_class=&schedule_id=`.
  Open spots + green fee come split by hole count (`available_spots_18`/`green_fee_9`…).
- **Tee-On** — Mill Woods, Coloniale, Lewis Estates, The Legends, Jagare Ridge. No
  JSON API; drive a browser: `ComboLanding?CourseCode=` → `WebBookingSearchSteps`
  form (Date/Holes/Players) → POST `WebBookingSearchResults`. Parse
  `.search-results-tee-times-box`; each card's
  `onclick="isNotLocked(code,side,date,time,holes,spots,…)"` gives spots, `.price`
  the fee. Tee-On **filters the sheet by party size upstream** (so the adapter takes
  `players`), only offers a short booking window (out-of-window dates surface a
  per-course error), and blocks single-golfer empty-slot bookings (so `players=1`
  legitimately returns few/none). **Lewis Estates** runs a CSS-driven "wait timer"
  overlay and only renders cards with stylesheets enabled → its registry entry sets
  `allowStyles:true` (keeps CSS, rides out the ~30-45s overlay; the others stay ~2s).
- **TeeItUp / GolfNow** (Kenna) — River Ridge. Public JSON, no auth/browser:
  `GET phx-api-be-east-1b.kenna.io/v2/tee-times?date=&facilityIds=<id>` with header
  `x-be-alias: <subdomain>`. Slots carry a UTC `teetime`, `maxPlayers-bookedPlayers`
  open spots, and `rates[]` per hole count with fees in **cents**. Fast (~0.8s).
- **Chronogolf / Lightspeed** — Broadmoor. Public JSON, no auth/browser:
  `GET <host>/marketplace/clubs/<clubId>/teetimes?date=&course_id=&nb_holes=&affiliation_type_ids[]=<publicId>`.
  Like Tee-On, party size is upstream (repeat the affiliation id per golfer, keep
  slots where `out_of_capacity` is false). `start_time` is local; `green_fees[].green_fee`
  is the price. Ids (club/course/public-affiliation) come from the booking widget's
  `/marketplace/organizations/<id>/affiliation_types` + `/clubs/<id>/courses`. Fast (~0.8s).
- **Club Prophet / CPS** — Country Side. **DISABLED (Cloudflare).** Reachable from a
  residential IP and issues an anonymous token (`identityapi/myconnect/token/short`),
  but the data APIs are behind a Cloudflare managed challenge that blocks automated
  access even headful/residential (verified 2026-06). `enabled:false`; see
  `src/adapters/clubprophet.ts` for the recon + why it's not built.
- **PerfectMind / MoveLearnPlay** — Victoria, Riverside (City of Edmonton). Booking
  sits behind a **virtual queue** (`golf/sendtoqueue` → `/queue/wait`). After release
  we POST `golf/TeeTimeSearch` with the page's `__RequestVerificationToken`; the HTML
  response has one `button[data-time]` `[data-spaces]` per slot (an empty date returns
  a 200 with an `alert-danger` "No times available" — that's a real empty result, not
  an error). No price exposed here (City fees are fixed) → price null. A released
  session can serve **many** searches, so a reactive warm pool reuses it to skip the
  queue (see Search speed). Measured: the queue is ~10–20s, but `TeeTimeSearch` itself
  is **~14s server-side** — slow because it's a capacity-limited, queue-gated backend.

## Current state

- **Working end-to-end for 10 courses** (Eagle Rock; Mill Woods, Coloniale, Lewis
  Estates, The Legends, Jagare Ridge; Victoria, Riverside; River Ridge; Broadmoor).
  Country Side is present but disabled (Cloudflare). Builds, typechecks, runs; live
  results, filtering, caching, and per-course error isolation verified (2026-06).
- **UI & Performance:** The frontend is mobile-responsive (stacking table cards on narrow screens), and search results are streamed to the client incrementally via Server-Sent Events (SSE) as each course finishes, preventing long loading screens.
- **Course selector:** the form has a per-course toggle (an "All" chip + one chip per course), defaulting to none selected. The selected ids ride along as a `courses=` param; `GET /api/courses` feeds the chips from `src/courses.ts` (single source of truth). Skipping the City courses avoids their slow virtual queue.
- **Search speed (2026-06):** the JSON adapters are ~1s — Eagle Rock (ForeUp), River
  Ridge (TeeItUp), Broadmoor (Chronogolf). The browser adapters wait on the actual
  data selector instead of `networkidle`/`waitForURL` timeouts, which cut Tee-On from
  ~65s to ~2s (exception: Lewis Estates ~30-45s, its own CSS-gated wait-timer). The
  City (PerfectMind) courses are ~33s cold; a **reactive warm pool**
  (`src/adapters/perfectmind.ts`) reuses the queue-released session so repeat searches
  skip the queue (~14s). The residual ~14s is the City's `TeeTimeSearch` endpoint
  itself and is the floor. Reactive only (no background keep-alive) to stay a good
  citizen; toggle with `PERFECTMIND_PREWARM=0`.
- **Country Side (Sherwood Park) ships disabled** (`enabled:false`). It runs on Club
  Prophet (`countrysideab.cps.golf`); the backend is reachable from a residential IP
  but its data APIs are **behind a Cloudflare managed challenge** that blocks automated
  access even headful/residential (verified 2026-06). Past it needs bot evasion →
  out of scope. Recon preserved in `src/adapters/clubprophet.ts`.

## Running it

```bash
npm install
npx playwright install chromium   # needed for teeon + perfectmind (browser-driven)
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
Woods/Lewis Estates (Tee-On), Victoria/Riverside (PerfectMind), River Ridge (TeeItUp),
Broadmoor (Chronogolf). Confirm 9 vs 18 returns different inventory/prices, and that a
larger party hides slots without room. Remember Tee-On's short booking window + singles
rule, and Lewis Estates' ~30-45s wait-timer, when results look sparse/slow — those are
real, not bugs.

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
  for backends that filter the sheet upstream (Tee-On, Chronogolf). ForeUp, PerfectMind,
  and TeeItUp fetch the whole sheet and we filter spots in `withinQuery`, so they share
  one entry across party sizes — keep that invariant if you touch caching/open-spots.
- **Don't block `stylesheet`** in the browser contexts (`src/browser.ts` blocks only
  image/media/font). Some Tee-On results pages won't render `.search-results-tee-times-box`
  without CSS, so the course silently returns 0. Courses that genuinely need it set
  `teeon.allowStyles:true` (e.g. Lewis Estates), which keeps CSS but is slower (the
  page's wait-timer overlay gates the search). Also: the catch-all `ctx.route` +
  `route.continue()` is slow on Windows, but blocking by resource type is fine.
- Be a good citizen: results are cached; don't hammer endpoints; no auto-booking.
- A course backend being unreachable surfaces as a per-course error in the response
  (`ok:false`), never a blank page — see `Promise.allSettled` in `aggregate.ts`.

## Out of scope (easy follow-ons)

Booking/checkout, accounts, push alerts when a desired slot opens, more courses. If
this ever becomes a product for other golfers, switch to official partner APIs.

**Country Side / Club Prophet — investigated, blocked.** CPS is reachable from a
residential IP but its data APIs are behind a Cloudflare managed challenge that blocks
automated access even headful/residential (verified 2026-06). Shipped `enabled:false`.
Getting past it needs bot-detection evasion (Turnstile/stealth) — not pursued (against
the good-citizen stance). Revisit only via an official partner API or if the challenge
is relaxed; recon is preserved in `src/adapters/clubprophet.ts`.

**PerfectMind queue pre-warm — DONE (reactive).** Built as a reactive warm pool in
`src/adapters/perfectmind.ts`: a queue-released session is reused to skip the queue on
repeat searches (~33s → ~14s). Measuring during the build revealed the gain is capped:
`TeeTimeSearch` is itself ~14s server-side (the floor), and a session stays reusable
for minutes. The remaining lever would be a **proactive background keep-alive** to keep
sessions warm between sittings — deliberately NOT done, because each keep-alive probe
is a real ~14s search against the City's capacity-limited backend (un-good-citizen).
If ever revisited, it should stay opt-in and load-bounded.
