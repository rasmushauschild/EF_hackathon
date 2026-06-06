# Custom Feed

Type a natural-language interest and an agent searches recent posts, then ranks them
into a custom feed by relevance. **MVP ships YouTube**; Hacker News, Reddit, and X are
designed to slot in next (see Roadmap).

How it works (per request, `POST /api/feed`):

1. **Plan** — Claude expands your interest into per-source search queries + a relevance
   rubric (`lib/agent.ts` → `planQueries`).
2. **Fetch** — each source client runs the queries with a recency window, normalized to a
   common `FeedItem` shape (`lib/sources/*`). Sources are isolated with
   `Promise.allSettled`, so one failure degrades to a warning.
3. **Rank** — Claude scores every candidate 0–100 against the rubric and writes a
   one-line "why it matches" (`lib/agent.ts` → `rankItems`).
4. **Render** — ranked cards with source badge, score, reason, link, thumbnail
   (`app/page.tsx`).

## Setup

1. **Install** (Conductor runs this automatically on workspace create):
   ```bash
   npm install
   ```
2. **Add keys** — copy the template and fill it in:
   ```bash
   cp .env.local.example .env.local
   ```
   - `ANTHROPIC_API_KEY` — from the Anthropic Console. Used for planning + ranking.
   - `YOUTUBE_API_KEY` — Google Cloud → APIs & Services → Credentials → API key, with
     **"YouTube Data API v3"** enabled. Free; ~100 searches/day.
   - Optional: `PLAN_MODEL` / `RANK_MODEL` (default `claude-opus-4-8`; set to
     `claude-sonnet-4-6` or `claude-haiku-4-5` for a faster/cheaper feed).
3. **Run:**
   ```bash
   npm run dev
   ```
   Open the printed URL. In Conductor this binds to `$CONDUCTOR_PORT` automatically so
   multiple agents/workspaces can run side by side.

## Running multiple agents in parallel (Conductor)

- `conductor.json` — `setup: npm install`, `run: npm run dev`, `runScriptMode: concurrent`.
- `package.json` scripts bind to `${CONDUCTOR_PORT:-3000}`, so parallel workspaces never
  collide on a port (falls back to 3000 outside Conductor).
- `.worktreeinclude` copies the gitignored `.env.local` (your keys) into every new
  workspace automatically — no manual re-entry per agent.

## Roadmap — adding a source

Sources are pluggable `SourceModule`s (see `lib/types.ts`). The planner, fetcher, and
ranker all iterate the registry, so adding a source touches **only two files** — its own
new file, plus one line in the registry. This keeps parallel "add a source" work in
separate Conductor workspaces near conflict-free.

To add one:

1. Create `lib/sources/<id>.ts` exporting a `SourceModule` (`id`, `label`, `planHint`,
   `enabled`, `search`). Follow `lib/sources/youtube.ts`; `search` returns normalized
   `FeedItem`s and throws on hard errors.
2. Add it to the `SOURCES` array in `lib/sources/registry.ts`.

That's it — `planQueries` auto-generates queries for it (only while `enabled()` is true),
`runSources` fetches it, and a badge style already exists in `app/page.tsx` for all four
source ids.

Planned, in order: **Hacker News** (Algolia `search_by_date`, no auth) →
**Reddit** (public `*.json` search) → **X/Twitter** (`/2/tweets/search/recent`,
pay-per-use Bearer token — start the dev-account signup early).
