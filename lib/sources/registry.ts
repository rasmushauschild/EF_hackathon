import type { SourceModule } from "@/lib/types";
import { youtubeSource } from "@/lib/sources/youtube";
import { redditSource } from "@/lib/sources/reddit";

/**
 * The list of pluggable sources.
 *
 * ── To add a source ──────────────────────────────────────────────────────────
 *   1. Create `lib/sources/<id>.ts` exporting a `SourceModule` (see youtube.ts).
 *   2. Import it here and add it to the array below.
 * That's the ONLY shared file you touch — planning (lib/agent.ts) and fetching
 * (lib/sources/index.ts) iterate this list, so they need no changes. This keeps
 * parallel "add a source" work in separate Conductor workspaces near conflict-free.
 */
export const SOURCES: SourceModule[] = [
  youtubeSource,
  redditSource,
  // hnSource,
  // xSource,
];

/** Sources that can actually run right now (required keys present, etc.). */
export const activeSources = (): SourceModule[] => SOURCES.filter((s) => s.enabled());
