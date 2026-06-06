import type { FeedItem, FeedPlan, SearchOpts } from "@/lib/types";
import { searchYouTube } from "@/lib/sources/youtube";

export interface SourceRun {
  items: FeedItem[];
  warnings: string[];
}

/**
 * Fan out to every configured source in parallel and merge the results.
 *
 * Each source is isolated with `Promise.allSettled`, so one failing/unconfigured
 * source (missing key, quota, network) degrades to a warning instead of failing
 * the whole feed. Add HN / Reddit / X here as their clients land — same shape.
 */
export async function runSources(plan: FeedPlan, opts: SearchOpts): Promise<SourceRun> {
  const tasks: { name: string; run: () => Promise<FeedItem[]> }[] = [];

  if (plan.youtube.length > 0) {
    tasks.push({ name: "YouTube", run: () => searchYouTube(plan.youtube, opts) });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));

  const items: FeedItem[] = [];
  const warnings: string[] = [];
  settled.forEach((result, i) => {
    const name = tasks[i].name;
    if (result.status === "fulfilled") {
      if (result.value.length === 0) warnings.push(`${name}: no recent results.`);
      items.push(...result.value);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`${name}: ${msg}`);
    }
  });

  return { items: dedupe(items), warnings };
}

/** Drop duplicate items by id (a video can surface for multiple queries/sources). */
function dedupe(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
