import type { FeedItem, SearchOpts, SourceModule } from "@/lib/types";

const SEARCH_URL = "https://oauth.reddit.com/search";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

// Reddit blocks requests with a generic/empty User-Agent; always send a descriptive one.
const USER_AGENT = "web:custom-feed-app:v0.1 (by /u/custom-feed-app)";

/** Registry entry — see lib/sources/registry.ts. */
export const redditSource: SourceModule = {
  id: "reddit",
  label: "Reddit",
  planHint:
    "3-5 search query strings tuned for Reddit (short keyword phrases; Reddit search is lexical, so avoid long sentences and boolean operators). You may scope a query to a community with `subreddit:name`.",
  // Reddit now 403s anonymous *.json from servers AND clients, so an app-only
  // OAuth credential is required (free to create at reddit.com/prefs/apps).
  enabled: () => !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
  search: (queries, opts) => searchReddit(queries, opts),
};

/**
 * Search Reddit for recent posts matching each query, deduped into FeedItems.
 *
 * Uses the app-only OAuth `search` endpoint. Reddit's `t` filter is bucketed
 * (day/week/month/…), so we pick the smallest bucket covering the window and
 * then filter precisely by `publishedAfter`. Throws on auth/HTTP errors so the
 * orchestrator can surface a warning.
 */
export async function searchReddit(
  queries: string[],
  opts: SearchOpts,
): Promise<FeedItem[]> {
  const token = await appToken();
  const after = Date.parse(opts.publishedAfter);

  // Run every query in parallel, then merge + dedupe.
  const perQuery = await Promise.all(queries.map((q) => runQuery(q, opts, token)));

  const byId = new Map<string, FeedItem>();
  for (const items of perQuery) {
    for (const item of items) {
      if (Date.parse(item.publishedAt) < after) continue; // enforce exact window
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/** Run a single search query and parse its hits into FeedItems. */
async function runQuery(
  q: string,
  opts: SearchOpts,
  token: string,
): Promise<FeedItem[]> {
  const params = new URLSearchParams({
    q,
    sort: "relevance",
    t: timeBucket(opts.publishedAfter),
    type: "link",
    limit: String(opts.maxResultsPerQuery),
    raw_json: "1", // return real characters instead of HTML entities
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();

  const items: FeedItem[] = [];
  for (const child of data?.data?.children ?? []) {
    const p = child?.data;
    if (!p?.id) continue;
    items.push({
      id: `reddit:${p.id}`,
      source: "reddit",
      title: p.title ?? "",
      text: typeof p.selftext === "string" ? p.selftext : "",
      author: p.author ? `u/${p.author}` : undefined,
      url: p.permalink ? `https://www.reddit.com${p.permalink}` : p.url,
      publishedAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
      engagement: Number.isFinite(p.score) ? p.score : undefined,
      thumbnail: validThumb(p.thumbnail),
    });
  }
  return items;
}

/** Reddit's `thumbnail` is often a sentinel ("self", "default", "nsfw") — keep only real URLs. */
function validThumb(thumb: unknown): string | undefined {
  return typeof thumb === "string" && thumb.startsWith("http") ? thumb : undefined;
}

/** Map an exact `publishedAfter` to Reddit's nearest (≥) time bucket. */
function timeBucket(publishedAfter: string): string {
  const day = 86_400_000;
  const ms = Date.now() - Date.parse(publishedAfter);
  if (ms <= day) return "day";
  if (ms <= 7 * day) return "week";
  if (ms <= 31 * day) return "month";
  if (ms <= 365 * day) return "year";
  return "all";
}

// Cache the app-only OAuth token across requests in this process.
let _token: { value: string; expiresAt: number } | null = null;

/**
 * Fetch (and cache) an app-only OAuth2 bearer token via the client-credentials
 * grant. `enabled()` guarantees the credentials are set before we get here.
 */
async function appToken(): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are not set");
  if (_token && _token.expiresAt > Date.now() + 60_000) return _token.value;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Reddit auth failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.access_token) throw new Error("Reddit auth returned no access_token");

  _token = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return _token.value;
}
