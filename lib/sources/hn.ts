import type { FeedItem, SearchOpts, SourceModule } from "@/lib/types";

// Algolia's HN Search API — free, keyless, and supports query + recency filtering.
// Docs: https://hn.algolia.com/api
const SEARCH_URL = "https://hn.algolia.com/api/v1/search";

/** Registry entry — see lib/sources/registry.ts. */
export const hnSource: SourceModule = {
  id: "hn",
  label: "Hacker News",
  planHint:
    "2-4 short keyword search query strings tuned for Hacker News (technical terms, product/company names, technologies; no boolean operators — Algolia matches all words).",
  // No API key required, so HN is always available.
  enabled: () => true,
  search: (queries, opts) => searchHN(queries, opts),
};

/**
 * Search Hacker News stories matching each query, deduped into FeedItems.
 *
 * Uses the Algolia `/search` endpoint (ranked by relevance) restricted to
 * `story` items within the recency window. Runs every query in parallel and
 * merges on objectID. Throws on hard errors so the orchestrator can warn.
 */
export async function searchHN(
  queries: string[],
  opts: SearchOpts,
): Promise<FeedItem[]> {
  const perQuery = await Promise.all(queries.map((q) => runQuery(q, opts)));

  const byId = new Map<string, FeedItem>();
  for (const items of perQuery) {
    for (const item of items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/** Run a single Algolia search query and parse its hits into FeedItems. */
async function runQuery(q: string, opts: SearchOpts): Promise<FeedItem[]> {
  // Algolia wants a Unix-seconds lower bound for the recency filter.
  const afterSec = Math.floor(Date.parse(opts.publishedAfter) / 1000);
  const params = new URLSearchParams({
    query: q,
    tags: "story",
    numericFilters: `created_at_i>${afterSec}`,
    hitsPerPage: String(opts.maxResultsPerQuery),
  });
  const res = await fetch(`${SEARCH_URL}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hacker News search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();

  const items: FeedItem[] = [];
  for (const hit of data.hits ?? []) {
    const objectID: string | undefined = hit.objectID;
    if (!objectID || !hit.title) continue;
    const discussionUrl = `https://news.ycombinator.com/item?id=${objectID}`;
    items.push({
      id: `hn:${objectID}`,
      source: "hn",
      title: hit.title,
      // Story text exists for Ask/Show HN posts; otherwise point at the discussion.
      text: hit.story_text ? stripTags(hit.story_text) : `${hit.num_comments ?? 0} comments`,
      author: hit.author,
      // Prefer the linked article; fall back to the HN discussion page.
      url: hit.url || discussionUrl,
      publishedAt: hit.created_at ?? new Date().toISOString(),
      engagement: typeof hit.points === "number" ? hit.points : undefined,
    });
  }
  return items;
}

/** HN story_text comes as HTML; strip tags + decode the few entities it uses. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}
