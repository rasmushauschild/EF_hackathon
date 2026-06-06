import type { FeedItem, SearchOpts } from "@/lib/types";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

/** Decode the HTML entities YouTube returns in titles/descriptions (e.g. &amp;, &#39;). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Search YouTube for recent videos matching each query, deduped into FeedItems.
 *
 * Uses the Data API v3 `search.list` endpoint (100 quota units/call). We then make
 * a single `videos.list` call (1 unit) to attach view counts for display/ranking.
 * Throws on auth/quota errors so the orchestrator can surface a warning.
 */
export async function searchYouTube(
  queries: string[],
  opts: SearchOpts,
): Promise<FeedItem[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");

  // Run every query in parallel, then merge + dedupe.
  const perQuery = await Promise.all(queries.map((q) => runQuery(q, opts, key)));

  const byId = new Map<string, FeedItem>();
  for (const items of perQuery) {
    for (const item of items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }

  await attachViewCounts(byId, key);
  return [...byId.values()];
}

/** Run a single search.list query and parse its hits into FeedItems. */
async function runQuery(q: string, opts: SearchOpts, key: string): Promise<FeedItem[]> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    order: "relevance",
    q,
    publishedAfter: opts.publishedAfter,
    maxResults: String(opts.maxResultsPerQuery),
    key,
  });
  const res = await fetch(`${SEARCH_URL}?${params}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const items: FeedItem[] = [];
  for (const it of data.items ?? []) {
    const videoId: string | undefined = it.id?.videoId;
    if (!videoId) continue;
    const sn = it.snippet ?? {};
    items.push({
      id: `youtube:${videoId}`,
      source: "youtube",
      title: decodeEntities(sn.title ?? ""),
      text: decodeEntities(sn.description ?? ""),
      author: sn.channelTitle,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: sn.publishedAt ?? new Date().toISOString(),
      thumbnail: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url,
    });
  }
  return items;
}

/** Best-effort enrichment: fill `engagement` with view counts. Never throws. */
async function attachViewCounts(byId: Map<string, FeedItem>, key: string): Promise<void> {
  const videoIds = [...byId.keys()].map((id) => id.slice("youtube:".length));
  if (videoIds.length === 0) return;
  try {
    // videos.list accepts up to 50 ids per call.
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const params = new URLSearchParams({
        part: "statistics",
        id: batch.join(","),
        key,
      });
      const res = await fetch(`${VIDEOS_URL}?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      for (const v of data.items ?? []) {
        const item = byId.get(`youtube:${v.id}`);
        const views = Number(v.statistics?.viewCount);
        if (item && Number.isFinite(views)) item.engagement = views;
      }
    }
  } catch {
    // View counts are a nice-to-have; ignore failures.
  }
}
