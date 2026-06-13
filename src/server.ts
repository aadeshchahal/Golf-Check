import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { aggregate, flatten } from "./aggregate.js";
import { closeBrowser } from "./browser.js";
import type { Holes, Query } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
  root: join(__dirname, "..", "public"),
});

function parseQuery(q: Record<string, unknown>): Query {
  const date = String(q.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD");

  const time = String(q.time ?? "08:00");
  if (!/^\d{1,2}:\d{2}$/.test(time)) throw new Error("time must be HH:mm");

  const windowMinutes = clamp(Number(q.window ?? 90), 0, 720);
  const players = clamp(Number(q.players ?? 1), 1, 4);
  const holesNum = Number(q.holes ?? 18);
  if (holesNum !== 9 && holesNum !== 18) throw new Error("holes must be 9 or 18");

  return { date, time, windowMinutes, players, holes: holesNum as Holes };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

app.get("/api/availability", async (req, reply) => {
  let query: Query;
  try {
    query = parseQuery(req.query as Record<string, unknown>);
  } catch (e) {
    reply.code(400);
    return { error: e instanceof Error ? e.message : "bad request" };
  }

  const results = await aggregate(query);
  return {
    query,
    courses: results,
    teeTimes: flatten(results),
  };
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await closeBrowser();
    await app.close();
    process.exit(0);
  });
}
