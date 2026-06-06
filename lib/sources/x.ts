import type { FeedItem, SearchOpts, SourceModule } from "@/lib/types";

const SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent";

// Appended to every query so we get original, English, substantive posts rather
// than retweets/replies. The planner only supplies the topical part (see planHint).
const QUERY_FILTERS = "-is:retweet -is:reply lang:en";

/** Registry entry — see lib/sources/registry.ts. */
export const xSource: SourceModule = {
  id: "x",
  label: "X",
  planHint:
    "3-5 search query strings tuned for X/Twitter. Use concise keyword phrases or hashtags; X boolean operators (OR, quoted phrases, from:user) are allowed, but DON'T add is:/lang: filters — those are applied automatically.",
  enabled: () => !!process.env.X_BEARER_TOKEN,
  search: (queries, opts) => searchX(queries, opts),
};

/**
 * Search X for recent tweets matching each query, deduped into FeedItems.
 *
 * Uses the v2 `tweets/search/recent` endpoint (last ~7 days). Each query runs in
 * parallel; results merge + dedupe by tweet id. Throws on auth/rate-limit errors
 * so the orchestrator can surface a warning.
 */
export async function searchX(queries: string[], opts: SearchOpts): Promise<FeedItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN is not set");

  const perQuery = await Promise.all(queries.map((q) => runQuery(q, opts, token)));

  const byId = new Map<string, FeedItem>();
  for (const items of perQuery) {
    for (const item of items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

interface XUser {
  id: string;
  username: string;
  name: string;
}

interface XMedia {
  media_key: string;
  url?: string;
  preview_image_url?: string;
}

/** Run a single recent-search query and parse its hits into FeedItems. */
async function runQuery(q: string, opts: SearchOpts, token: string): Promise<FeedItem[]> {
  // v2 recent search caps max_results at 100 and requires it to be >= 10.
  const maxResults = Math.min(100, Math.max(10, opts.maxResultsPerQuery));
  const params = new URLSearchParams({
    query: `${q} ${QUERY_FILTERS}`.trim(),
    max_results: String(maxResults),
    start_time: opts.publishedAfter,
    "tweet.fields": "created_at,public_metrics,author_id,attachments",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "username,name",
    "media.fields": "url,preview_image_url",
  });

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();

  const usersById = new Map<string, XUser>(
    (data.includes?.users ?? []).map((u: XUser) => [u.id, u]),
  );
  const mediaByKey = new Map<string, XMedia>(
    (data.includes?.media ?? []).map((m: XMedia) => [m.media_key, m]),
  );

  const items: FeedItem[] = [];
  for (const t of data.data ?? []) {
    const user = t.author_id ? usersById.get(t.author_id) : undefined;
    const username = user?.username;
    const metrics = t.public_metrics ?? {};
    const text: string = t.text ?? "";
    const mediaKey: string | undefined = t.attachments?.media_keys?.[0];
    const media = mediaKey ? mediaByKey.get(mediaKey) : undefined;

    items.push({
      id: `x:${t.id}`,
      source: "x",
      // Tweets have no title; use a trimmed first line as the headline.
      title: titleFrom(text),
      text,
      author: user ? `${user.name} (@${username})` : username,
      url: username
        ? `https://x.com/${username}/status/${t.id}`
        : `https://x.com/i/status/${t.id}`,
      publishedAt: t.created_at ?? new Date().toISOString(),
      engagement:
        (metrics.like_count ?? 0) +
        (metrics.retweet_count ?? 0) +
        (metrics.quote_count ?? 0),
      thumbnail: media?.url ?? media?.preview_image_url,
    });
  }
  return items;
}

/** Derive a short single-line headline from a tweet body. */
function titleFrom(text: string): string {
  const firstLine = text.split("\n").map((l) => l.trim()).find(Boolean) ?? text.trim();
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}
