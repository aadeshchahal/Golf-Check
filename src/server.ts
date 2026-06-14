import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { streamAggregate, flatten } from "./aggregate.js";
import { closeBrowser } from "./browser.js";
import { enabledCourses } from "./courses.js";
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

  // Optional comma-separated course ids; empty/absent means "all enabled".
  const courseIds = String(q.courses ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { date, time, windowMinutes, players, holes: holesNum as Holes, courseIds };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// Course registry for the front-end's selector (single source of truth).
app.get("/api/courses", async () => {
  return enabledCourses().map((c) => ({ id: c.id, name: c.name }));
});

app.get("/api/availability", async (req, reply) => {
  let query: Query;
  try {
    query = parseQuery(req.query as Record<string, unknown>);
  } catch (e) {
    reply.code(400);
    return { error: e instanceof Error ? e.message : "bad request" };
  }

  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.flushHeaders();

  await streamAggregate(query, (result) => {
    reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
  });

  reply.raw.write(`data: [DONE]\n\n`);
  reply.raw.end();
  return reply;
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
