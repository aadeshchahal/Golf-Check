/**
 * One-time discovery helper.
 *
 * Chronogolf and MoveLearnPlay block automated/datacenter traffic, so this must
 * be run on a machine with normal (residential) internet access:
 *
 *     npm install
 *     npx playwright install chromium
 *     npm run discover
 *
 * It opens each course's real booking page in a headless browser, captures the
 * availability network calls the page fires, and prints the IDs you paste into
 * src/courses.ts:
 *   - Chronogolf:  clubId, course_id(s), affiliation_type_ids
 *   - PerfectMind: the availability XHR URL + a sample of the JSON body
 *
 * Tip: if a page shows an anti-bot challenge, set HEADFUL=1 to watch/solve it:
 *     HEADFUL=1 npm run discover
 */
import { chromium } from "playwright";
import { COURSES } from "../src/courses.js";
import type { Course } from "../src/types.js";

const HEADFUL = process.env.HEADFUL === "1";
// A date a week out is more likely to have an open tee sheet than today.
const DATE = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

function line() {
  console.log("─".repeat(72));
}

async function discoverChronogolf(course: Course) {
  const cfg = course.chronogolf!;
  const url = `https://${cfg.host}/club/${cfg.slug}?date=${DATE}`;
  console.log(`\n${course.name}  [chronogolf]\n${url}`);

  const browser = await chromium.launch({ headless: !HEADFUL });
  const ctx = await browser.newContext({ locale: "en-CA" });
  const page = await ctx.newPage();

  const teetimeUrls = new Set<string>();
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/teetimes")) teetimeUrls.add(u);
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    console.log(`  ! navigation issue: ${(e as Error).message}`);
  }

  if (teetimeUrls.size === 0) {
    console.log("  No /teetimes calls captured. Try HEADFUL=1 and pick a date in the widget.");
  }
  for (const u of teetimeUrls) {
    const parsed = new URL(u);
    const clubId = parsed.pathname.match(/clubs\/(\d+)\/teetimes/)?.[1];
    console.log(`  teetimes call:`);
    console.log(`    clubId            = ${clubId ?? "?"}`);
    console.log(`    course_id         = ${parsed.searchParams.get("course_id")}`);
    console.log(`    nb_holes          = ${parsed.searchParams.get("nb_holes")}`);
    console.log(`    affiliation_type_ids = ${parsed.searchParams.getAll("affiliation_type_ids[]").join(", ")}`);
  }

  await browser.close();
}

async function discoverPerfectMind(course: Course) {
  const cfg = course.perfectmind!;
  const url = `https://${cfg.host}${cfg.basePath}/golf/course/${cfg.guid}?date=${DATE}`;
  console.log(`\n${course.name}  [perfectmind]\n${url}`);

  const browser = await chromium.launch({ headless: !HEADFUL });
  const ctx = await browser.newContext({ locale: "en-CA" });
  const page = await ctx.newPage();

  const jsonCalls: { url: string; sample: unknown }[] = [];
  page.on("response", async (res) => {
    const ct = res.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const body = await res.json();
      jsonCalls.push({ url: res.url(), sample: body });
    } catch {
      /* ignore */
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    console.log(`  ! navigation issue: ${(e as Error).message}`);
  }

  if (jsonCalls.length === 0) {
    console.log("  No JSON calls captured. Try HEADFUL=1 to inspect the network tab manually.");
  }
  for (const c of jsonCalls) {
    const preview = JSON.stringify(c.sample).slice(0, 400);
    console.log(`  JSON call: ${c.url}`);
    console.log(`    sample: ${preview}${preview.length >= 400 ? "…" : ""}`);
  }

  await browser.close();
}

async function main() {
  console.log(`Discovery for date ${DATE} (headful=${HEADFUL})`);
  for (const course of COURSES) {
    line();
    try {
      if (course.backend === "chronogolf") await discoverChronogolf(course);
      else if (course.backend === "perfectmind") await discoverPerfectMind(course);
    } catch (e) {
      console.log(`  error: ${(e as Error).message}`);
    }
  }
  line();
  console.log("\nPaste the captured ids into src/courses.ts, then `npm run dev`.");
}

main();
