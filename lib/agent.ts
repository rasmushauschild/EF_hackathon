import Anthropic from "@anthropic-ai/sdk";
import type { FeedItem, FeedPlan, RankedItem, WhyRow } from "@/lib/types";
import { activeSources } from "@/lib/sources/registry";

// Haiku by default for a fast, interactive feed. Bump to claude-sonnet-4-6 or
// claude-opus-4-8 via env if you want higher-quality planning/ranking.
const PLAN_MODEL = process.env.PLAN_MODEL ?? "claude-haiku-4-5";
const RANK_MODEL = process.env.RANK_MODEL ?? "claude-haiku-4-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  _client ??= new Anthropic();
  return _client;
}

/**
 * Pull the single forced tool call out of a response and return its input.
 * We use forced tool-use (tool_choice) as a version-robust way to get
 * structured JSON back from the model.
 */
function toolInput<T>(message: Anthropic.Message, toolName: string): T {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === toolName,
  );
  if (!block) throw new Error(`Model did not call ${toolName}`);
  return block.input as T;
}

const SCORE_SYSTEM = `You score candidate posts by how well they match a person's interest.

You are given the interest, a rubric, and a JSON array of candidates, each with an integer index "i". For EVERY candidate, output:
- i: the candidate's index, unchanged.
- score: integer 0-100 for how well it matches the interest and rubric (100 = perfect, 0 = irrelevant).

Judge on topical relevance to the rubric first; use recency and quality as secondary signals. Be discerning — reserve high scores for genuinely strong matches. Score every candidate. Output only scores; do not explain.`;

const EXPLAIN_SYSTEM = `You write a one-sentence relevance note for each post, for an end user browsing a custom feed.

You are given the interest, a rubric, and a small JSON array of posts, each with an integer index "i". For EVERY post, output:
- i: the post's index, unchanged.
- why: ONE short, specific sentence on why it matches the interest (or how it relates). No preamble.`;

interface ScoreRow {
  i: number;
  score: number;
}

/**
 * Expand a free-text interest into per-source search queries + a relevance rubric.
 *
 * The query schema and prompt are built from the *active* sources in the registry,
 * so the planner only generates queries for sources that can actually run (which
 * keeps the call fast) and automatically covers any new source that's added.
 */
export async function planQueries(prompt: string): Promise<FeedPlan> {
  const active = activeSources();
  const platformLines = active.map((s) => `- ${s.id}: ${s.planHint}`).join("\n");
  const system = `You turn a person's described interest into effective search queries for finding RECENT posts, plus a rubric for judging relevance.

Produce:
- refinedInterest: a one-sentence restatement of what they actually want to see.
- rubric: 1-2 sentences describing what makes a post a STRONG match vs a weak one. Be specific about topics and quality signals. Used to score results later — keep it tight.
- queries: for each platform below, the requested search query strings.

Platforms:
${platformLines}

Favor precision over breadth. Avoid overly generic queries that would return noise.`;

  const queryProps = Object.fromEntries(
    active.map((s) => [s.id, { type: "array", items: { type: "string" } }]),
  );

  const message = await client().messages.create({
    model: PLAN_MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "emit_plan" },
    tools: [
      {
        name: "emit_plan",
        description: "Return per-platform search queries and a relevance rubric.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            refinedInterest: { type: "string" },
            rubric: { type: "string" },
            queries: {
              type: "object",
              additionalProperties: false,
              properties: queryProps,
              required: active.map((s) => s.id),
            },
          },
          required: ["refinedInterest", "rubric", "queries"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Interest: ${prompt}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
      },
    ],
  });

  return toolInput<FeedPlan>(message, "emit_plan");
}

/**
 * Score each candidate 0-100 against the interest + rubric and return items
 * sorted by relevance (desc). Scores only — no per-item explanation — which
 * keeps output tiny and fast. `why` starts empty and is filled later by
 * `explainItems`. Items the model omits fall to the bottom with score 0.
 */
export async function scoreItems(
  plan: FeedPlan,
  items: FeedItem[],
): Promise<RankedItem[]> {
  if (items.length === 0) return [];

  const candidates = items.map((it, i) => ({
    i,
    title: it.title,
    snippet: (it.text ?? "").slice(0, 160),
    date: it.publishedAt.slice(0, 10),
  }));

  const message = await client().messages.create({
    model: RANK_MODEL,
    max_tokens: 4096,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: SCORE_SYSTEM, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "emit_scores" },
    tools: [
      {
        name: "emit_scores",
        description: "Return a relevance score for every candidate, keyed by index.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            scores: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  i: { type: "integer" },
                  score: { type: "integer" },
                },
                required: ["i", "score"],
              },
            },
          },
          required: ["scores"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Interest: ${plan.refinedInterest}\n\nRubric: ${plan.rubric}\n\nCandidates (JSON):\n${JSON.stringify(candidates)}`,
      },
    ],
  });

  const { scores } = toolInput<{ scores: ScoreRow[] }>(message, "emit_scores");
  const scoreByIndex = new Map(scores.map((r) => [r.i, r.score]));

  const ranked: RankedItem[] = items.map((it, i) => ({
    ...it,
    score: clampScore(scoreByIndex.get(i) ?? 0),
    why: "",
  }));

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (b.engagement ?? 0) - (a.engagement ?? 0) ||
      Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  return ranked;
}

/**
 * Generate a one-sentence relevance note for a small set of (top) items in a
 * single call. Runs off the first-paint path so cards render before reasons.
 */
export async function explainItems(
  plan: FeedPlan,
  items: FeedItem[],
): Promise<WhyRow[]> {
  if (items.length === 0) return [];

  const posts = items.map((it, i) => ({
    i,
    title: it.title,
    snippet: (it.text ?? "").slice(0, 160),
  }));

  const message = await client().messages.create({
    model: RANK_MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: EXPLAIN_SYSTEM, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "emit_explanations" },
    tools: [
      {
        name: "emit_explanations",
        description: "Return a one-sentence relevance note for every post, keyed by index.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            explanations: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  i: { type: "integer" },
                  why: { type: "string" },
                },
                required: ["i", "why"],
              },
            },
          },
          required: ["explanations"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Interest: ${plan.refinedInterest}\n\nRubric: ${plan.rubric}\n\nPosts (JSON):\n${JSON.stringify(posts)}`,
      },
    ],
  });

  const { explanations } = toolInput<{ explanations: { i: number; why: string }[] }>(
    message,
    "emit_explanations",
  );
  // Map index back to the item's stable id for the client.
  return explanations
    .filter((e) => items[e.i])
    .map((e) => ({ id: items[e.i].id, why: e.why }));
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
