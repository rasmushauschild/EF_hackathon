import { planQueries, scoreItems, explainItems } from "@/lib/agent";
import { runSources } from "@/lib/sources";
import type { FeedResponse, FeedStreamEvent, RankedItem } from "@/lib/types";

export const runtime = "nodejs";
// Agent + multi-query fetch can take a while; give it room.
export const maxDuration = 120;

const DEFAULT_WINDOW_HOURS = 24 * 14; // last two weeks
const MAX_RESULTS_PER_QUERY = 6;
const MAX_CANDIDATES = 30; // cap sent to the scorer for cost/latency
const TOP_EXPLAIN = 10; // how many top items get a lazy "why"

// Tiny in-memory cache so repeated prompts (and parallel agents iterating) don't
// re-hit the APIs. Process-local; resets on redeploy. Good enough for a feed.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: FeedResponse }>();

export async function POST(req: Request) {
  let prompt = "";
  let windowHours = DEFAULT_WINDOW_HOURS;
  try {
    const body = await req.json();
    prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (Number.isFinite(body?.windowHours)) windowHours = Number(body.windowHours);
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  if (!prompt) return jsonError("Missing 'prompt'.", 400);

  const cacheKey = `${windowHours}:${prompt.toLowerCase()}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: FeedStreamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      const t0 = Date.now();
      const lap = (label: string, since: number) =>
        console.log(`[feed] ${label}: ${((Date.now() - since) / 1000).toFixed(1)}s`);

      try {
        // Cache hit: replay the stored feed immediately (sub-100ms).
        const hit = cache.get(cacheKey);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
          send({ type: "plan", plan: hit.data.plan });
          send({ type: "items", items: hit.data.items, warnings: hit.data.warnings });
          send({ type: "done" });
          return; // `finally` closes the controller
        }

        let t = Date.now();
        const plan = await planQueries(prompt);
        lap("plan", t);
        send({ type: "plan", plan });

        t = Date.now();
        const publishedAfter = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
        const { items, warnings } = await runSources(plan, {
          publishedAfter,
          maxResultsPerQuery: MAX_RESULTS_PER_QUERY,
        });
        lap("fetch", t);

        t = Date.now();
        const ranked = await scoreItems(plan, items.slice(0, MAX_CANDIDATES));
        lap(`score(${Math.min(items.length, MAX_CANDIDATES)})`, t);
        send({ type: "items", items: ranked, warnings });

        // Off the first-paint path: explain only the top items.
        t = Date.now();
        const top = ranked.slice(0, TOP_EXPLAIN);
        const why = await explainItems(plan, top);
        lap(`explain(${top.length})`, t);
        send({ type: "why", why });

        // Merge reasons back in and cache the complete feed.
        const whyById = new Map(why.map((w) => [w.id, w.why]));
        const merged: RankedItem[] = ranked.map((it) => ({
          ...it,
          why: whyById.get(it.id) ?? it.why,
        }));
        cache.set(cacheKey, { at: Date.now(), data: { prompt, plan, items: merged, warnings } });

        lap("TOTAL", t0);
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
