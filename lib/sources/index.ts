import type { FeedItem, FeedPlan, SearchOpts } from "@/lib/types";
import { activeSources } from "@/lib/sources/registry";

export interface SourceRun {
  items: FeedItem[];
  warnings: string[];
}

/**
 * Fan out to every active source that has queries in the plan, in parallel,
 * and merge the results. Each source is isolated with `Promise.allSettled`, so
 * one failing/empty source degrades to a warning instead of failing the feed.
 *
 * Sources come from the registry (lib/sources/registry.ts) — adding one needs
 * no change here.
 */
export async function runSources(plan: FeedPlan, opts: SearchOpts): Promise<SourceRun> {
  const sources = activeSources().filter((s) => (plan.queries[s.id]?.length ?? 0) > 0);

  const settled = await Promise.allSettled(
    sources.map((s) => s.search(plan.queries[s.id] ?? [], opts)),
  );

  const items: FeedItem[] = [];
  const warnings: string[] = [];
  settled.forEach((result, i) => {
    const { label } = sources[i];
    if (result.status === "fulfilled") {
      if (result.value.length === 0) warnings.push(`${label}: no recent results.`);
      items.push(...result.value);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`${label}: ${msg}`);
    }
  });

  return { items: dedupe(items), warnings };
}

/** Drop duplicate items by id (a post can surface for multiple queries/sources). */
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
