// Shared types for the custom-feed app.

/** Sources the agent can pull from. MVP ships `youtube`; the rest are added incrementally. */
export type Source = "youtube" | "hn" | "reddit" | "x";

/** A single post normalized to a common shape across every source. */
export interface FeedItem {
  /** Stable unique id, e.g. `youtube:VIDEO_ID`. */
  id: string;
  source: Source;
  title: string;
  /** Description / body snippet, if any. */
  text?: string;
  author?: string;
  url: string;
  /** ISO 8601 timestamp. */
  publishedAt: string;
  /** Views / points / score — used only for display and tie-breaking. */
  engagement?: number;
  thumbnail?: string;
}

/** Per-source search queries + a relevance rubric, produced by the planning agent. */
export interface FeedPlan {
  /** Short restatement of what the user is actually looking for. */
  refinedInterest: string;
  /** What makes a post a strong match — fed to the ranking step. */
  rubric: string;
  /** Search queries keyed by source id. Only active sources are present. */
  queries: Partial<Record<Source, string[]>>;
}

/** A feed item enriched with the agent's relevance judgement. */
export interface RankedItem extends FeedItem {
  /** 0–100 relevance score. */
  score: number;
  /** One-sentence explanation of why it matches the interest. */
  why: string;
}

/** Response shape assembled from the feed stream (also what the cache stores). */
export interface FeedResponse {
  prompt: string;
  plan: FeedPlan;
  items: RankedItem[];
  /** Non-fatal notices (e.g. a source failed or returned nothing). */
  warnings: string[];
}

/** A lazily-generated relevance explanation for one item. */
export interface WhyRow {
  id: string;
  why: string;
}

/**
 * Events streamed (one JSON object per line, NDJSON) from POST /api/feed so the
 * UI can render progressively: plan → cards → reasons.
 */
export type FeedStreamEvent =
  | { type: "plan"; plan: FeedPlan }
  | { type: "items"; items: RankedItem[]; warnings: string[] }
  | { type: "why"; why: WhyRow[] }
  | { type: "done" }
  | { type: "error"; error: string };

/** Recency window + per-query result cap passed to source clients. */
export interface SearchOpts {
  /** ISO 8601 lower bound on publish time. */
  publishedAfter: string;
  maxResultsPerQuery: number;
}

/**
 * A pluggable source. To add a source: create `lib/sources/<id>.ts` exporting a
 * SourceModule, then add it to the SOURCES array in `lib/sources/registry.ts`.
 * Nothing else needs editing — planning and ranking adapt automatically.
 */
export interface SourceModule {
  id: Source;
  /** Human label for badges/warnings. */
  label: string;
  /** Instruction the planner uses to generate this source's search queries. */
  planHint: string;
  /** Whether this source can run right now (e.g. a required key is present). */
  enabled: () => boolean;
  /** Run the source's search for the given queries. Throw on hard errors. */
  search: (queries: string[], opts: SearchOpts) => Promise<FeedItem[]>;
}
