"use client";

import { useState } from "react";
import type { FeedPlan, FeedStreamEvent, RankedItem, Source } from "@/lib/types";

const EXAMPLE = "people hacking on AR hardware";
const TOP_EXPLAIN = 10; // matches the server; items beyond this won't get a "why"
const DEFAULT_WINDOW_HOURS = 24 * 7; // recency is fixed (no UI); keeps /api/feed unchanged

/** Source presentation: badge style (cards) + brand color (active icon). */
const SOURCE_META: Record<Source, { label: string; badge: string; brand: string }> = {
  youtube: { label: "YouTube", badge: "bg-red-100 text-red-700", brand: "text-red-600" },
  x: { label: "X", badge: "bg-neutral-200 text-neutral-800", brand: "text-neutral-900" },
  reddit: { label: "Reddit", badge: "bg-orange-100 text-orange-700", brand: "text-orange-500" },
  hn: { label: "Hacker News", badge: "bg-amber-100 text-amber-700", brand: "text-orange-600" },
};

const SOURCE_ORDER: Source[] = ["youtube", "x", "reddit", "hn"];

/** Minimal monochrome logo glyphs (inherit color via currentColor). */
function SourceIcon({ source, className }: { source: Source; className?: string }) {
  switch (source) {
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M18.9 1.2h3.7l-8 9.1L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9 6.1-6.9zm-1.3 19.4h2L6.5 3.3H4.3l13.3 17.3z" />
        </svg>
      );
    case "reddit":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm6.7 13.2c.1.3.1.5.1.8 0 2.8-3.2 5-7.2 5s-7.2-2.2-7.2-5c0-.3 0-.5.1-.8-.6-.3-1-.9-1-1.6 0-1 .8-1.8 1.8-1.8.5 0 .9.2 1.2.5 1.2-.9 2.9-1.4 4.7-1.5l.8-3.8c0-.1.1-.2.2-.2l2.7.6c.2-.4.6-.7 1.1-.7.7 0 1.2.5 1.2 1.2s-.5 1.2-1.2 1.2c-.6 0-1.1-.4-1.2-1l-2.4-.5-.7 3.4c1.8.1 3.4.6 4.6 1.5.3-.3.7-.5 1.2-.5 1 0 1.8.8 1.8 1.8 0 .7-.4 1.3-1 1.6zm-9.3.3c-.7 0-1.2.5-1.2 1.2s.5 1.2 1.2 1.2 1.2-.5 1.2-1.2-.6-1.2-1.2-1.2zm5 3.2c-.6.6-1.8.6-2.4.6s-1.8 0-2.4-.6c-.1-.1-.3-.1-.4 0-.1.1-.1.3 0 .4.8.8 2.2.8 2.8.8s2 0 2.8-.8c.1-.1.1-.3 0-.4-.1-.1-.3-.1-.4 0zm-.1-3.2c-.7 0-1.2.5-1.2 1.2s.5 1.2 1.2 1.2 1.2-.5 1.2-1.2-.5-1.2-1.2-1.2z" />
        </svg>
      );
    case "hn":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
          <path d="M3 2h18v20H3V2zm8 12.3L7 5.8h2.2L12 11l2.8-5.2H17l-4 8.5V19h-2v-4.7z" />
        </svg>
      );
  }
}

/** A few empty frosted boxes in the source size-formats, to wallpaper the idle screen. */
const WALL_ASPECTS = [
  "aspect-square",
  "aspect-[3/4]",
  "aspect-video",
  "aspect-[4/5]",
  "aspect-square",
  "aspect-video",
  "aspect-[3/4]",
  "aspect-square",
  "aspect-video",
  "aspect-[4/5]",
  "aspect-square",
  "aspect-[3/4]",
  "aspect-video",
  "aspect-square",
  "aspect-[4/5]",
  "aspect-video",
  "aspect-[3/4]",
  "aspect-square",
  "aspect-video",
  "aspect-[4/5]",
  "aspect-square",
  "aspect-[3/4]",
  "aspect-video",
  "aspect-square",
];

type Phase = "idle" | "planning" | "ranking" | "explaining" | "done";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  planning: "Planning searches…",
  ranking: "Searching and ranking…",
  explaining: "Writing relevance notes…",
  done: "",
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<FeedPlan | null>(null);
  const [items, setItems] = useState<RankedItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Visual-only for now: toggles render but don't filter results yet.
  const [sources, setSources] = useState<Record<Source, boolean>>({
    youtube: true,
    x: true,
    reddit: true,
    hn: true,
  });

  const loading = phase === "planning" || phase === "ranking" || phase === "explaining";
  const showHero = phase === "idle" && items.length === 0 && !error;

  async function buildFeed() {
    const q = prompt.trim();
    if (!q || loading) return;
    setError(null);
    setPlan(null);
    setItems([]);
    setWarnings([]);
    setPhase("planning");

    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: q, windowHours: DEFAULT_WINDOW_HOURS }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) handleEvent(JSON.parse(line) as FeedStreamEvent);
        }
      }
      const last = buf.trim();
      if (last) handleEvent(JSON.parse(last) as FeedStreamEvent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("idle");
    }
  }

  function handleEvent(e: FeedStreamEvent) {
    switch (e.type) {
      case "plan":
        setPlan(e.plan);
        setPhase("ranking");
        break;
      case "items":
        setItems(e.items);
        setWarnings(e.warnings);
        setPhase("explaining");
        break;
      case "why": {
        const byId = new Map(e.why.map((w) => [w.id, w.why]));
        setItems((prev) => prev.map((it) => ({ ...it, why: byId.get(it.id) ?? it.why })));
        break;
      }
      case "done":
        setPhase("done");
        break;
      case "error":
        setError(e.error);
        setPhase("idle");
        break;
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col">
      {/* Top bar: floating glass source toggles (icon only) */}
      <header className="pointer-events-none sticky top-0 z-20 flex items-center justify-center gap-3 px-4 py-4">
        {SOURCE_ORDER.map((id) => {
          const meta = SOURCE_META[id];
          const on = sources[id];
          return (
            <button
              key={id}
              onClick={() => setSources((s) => ({ ...s, [id]: !s[id] }))}
              aria-pressed={on}
              aria-label={meta.label}
              title={meta.label}
              className={`pointer-events-auto grid h-11 w-11 place-items-center rounded-full border backdrop-blur-xl transition ${
                on
                  ? `border-white/60 bg-white/70 ${meta.brand} shadow-lg shadow-orange-500/10`
                  : "border-white/30 bg-white/30 text-neutral-400 shadow-sm hover:bg-white/50 hover:text-neutral-600"
              }`}
            >
              <SourceIcon source={id} className="h-5 w-5" />
            </button>
          );
        })}
      </header>

      {/* Content region */}
      <div className="flex flex-1 flex-col pb-44">
        {showHero ? (
          <div className="relative -mt-20 flex flex-1 overflow-hidden">
            <PlaceholderWall />
            {/* soft white wash so the centered hero reads over the boxes */}
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(closest-side,rgba(252,250,248,0.92),rgba(252,250,248,0)_70%)]" />
            <div className="pointer-events-none relative z-10 m-auto px-4 text-center">
              <h1 className="text-5xl font-semibold tracking-tight text-neutral-900 sm:text-6xl">
                Take back control.
              </h1>
              <p className="mt-2 text-5xl font-light tracking-tight text-neutral-400 sm:text-6xl">
                Build your feed.
              </p>
            </div>
          </div>
        ) : (
          <section className="mx-auto w-full max-w-6xl px-4 pt-2">
            {error && (
              <div className="mb-4 rounded-2xl border border-red-200/70 bg-red-50/80 p-3 text-sm text-red-700 backdrop-blur">
                {error}
              </div>
            )}

            {plan?.refinedInterest && (
              <p className="mb-3 flex items-center gap-2 text-sm text-neutral-500">
                <span>
                  Showing: <span className="font-medium text-neutral-700">{plan.refinedInterest}</span>
                </span>
                {loading && PHASE_LABEL[phase] && (
                  <span className="text-xs text-neutral-400">· {PHASE_LABEL[phase]}</span>
                )}
              </p>
            )}

            {warnings.length > 0 && (
              <div className="mb-4 rounded-2xl border border-amber-200/70 bg-amber-50/80 p-3 text-xs text-amber-800 backdrop-blur">
                {warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}

            {items.length > 0 ? (
              <>
                <div className="gap-3 [column-fill:_balance] columns-2 sm:columns-3 lg:columns-4">
                  {items.map((item, i) => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      pendingWhy={phase === "explaining" && i < TOP_EXPLAIN && !item.why}
                    />
                  ))}
                </div>
                {phase === "done" && <EndMarker />}
              </>
            ) : phase === "done" ? (
              <p className="text-sm text-neutral-500">
                No matching posts found. Try a broader interest.
              </p>
            ) : (
              <FeedSkeleton />
            )}
          </section>
        )}
      </div>

      {/* Bottom input bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-6">
        <div className="pointer-events-auto w-full max-w-2xl rounded-[1.75rem] border border-white/50 bg-white/40 p-2 shadow-xl shadow-orange-500/5 backdrop-blur-2xl">
          <div className="flex items-end gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  buildFeed();
                }
              }}
              rows={1}
              placeholder={`Build your feed — e.g. "${EXAMPLE}"`}
              className="max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent px-3 py-2.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
            />
            <button
              onClick={buildFeed}
              disabled={loading || !prompt.trim()}
              aria-label="Build feed"
              className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-neutral-900 text-white transition hover:bg-neutral-700 disabled:opacity-30"
            >
              {loading ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                  <path
                    d="M12 19V5M12 5l-6 6M12 5l6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function FeedCard({ item, pendingWhy }: { item: RankedItem; pendingWhy: boolean }) {
  const meta = SOURCE_META[item.source];

  // Reddit / Hacker News read as wide (landscape) cards with a side-by-side layout.
  const wide = item.source === "reddit" || item.source === "hn";
  // X reads as a tall (portrait) card; YouTube as a square-thumbnail card.
  const mediaAspect =
    item.source === "youtube" ? "aspect-square" : item.source === "x" ? "aspect-[3/4]" : "aspect-video";

  const header = (
    <div className="mb-1.5 flex items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
        {meta.label}
      </span>
      <span
        className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
        title="Relevance score"
      >
        {item.score}
      </span>
    </div>
  );

  const body = (
    <>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="line-clamp-3 text-sm font-medium leading-snug text-neutral-900 hover:underline"
      >
        {item.title}
      </a>
      {item.why ? (
        <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{item.why}</p>
      ) : pendingWhy ? (
        <div className="mt-1.5 h-2.5 w-3/4 animate-pulse rounded bg-white/60" />
      ) : null}
      <div className="mt-1.5 text-[10px] text-neutral-400">
        {[item.author, timeAgo(item.publishedAt), views(item.engagement)]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </>
  );

  return (
    <div className="mb-3 break-inside-avoid rounded-xl border border-white/50 bg-white/30 p-2 shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white/40 hover:shadow-md">
      {wide ? (
        <div className="flex gap-2">
          {item.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnail}
              alt=""
              className="aspect-video w-2/5 shrink-0 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            {header}
            {body}
          </div>
        </div>
      ) : (
        <>
          {item.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnail}
              alt=""
              className={`mb-2 w-full rounded-lg object-cover ${mediaAspect}`}
            />
          )}
          {header}
          {body}
        </>
      )}
    </div>
  );
}

function PlaceholderWall() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 gap-4 columns-2 px-4 pt-24 sm:columns-3 md:columns-4 lg:columns-5"
    >
      {WALL_ASPECTS.map((a, i) => (
        <div
          key={i}
          className={`mb-4 break-inside-avoid rounded-2xl border border-white/50 bg-white/30 shadow-sm backdrop-blur-md ${a}`}
        />
      ))}
    </div>
  );
}

function FeedSkeleton() {
  // Mixed aspect ratios so the placeholder mirrors the masonry layout.
  const aspects = ["aspect-square", "aspect-[3/4]", "aspect-video", "aspect-square", "aspect-[4/5]", "aspect-video"];
  return (
    <div className="gap-3 columns-2 sm:columns-3 lg:columns-4">
      {aspects.map((a, i) => (
        <div
          key={i}
          className="mb-3 break-inside-avoid rounded-xl border border-white/50 bg-white/30 p-2 shadow-sm backdrop-blur-md"
        >
          <div className={`mb-2 w-full animate-pulse rounded-lg bg-white/50 ${a}`} />
          <div className="space-y-1.5">
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-white/50" />
            <div className="h-2.5 w-5/6 animate-pulse rounded bg-white/50" />
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EndMarker() {
  return (
    <div className="mt-10 mb-6 flex flex-col items-center text-center">
      <p className="text-sm font-medium text-neutral-500">You reached the end.</p>
      <p className="text-sm text-neutral-400">Go touch some grass.</p>
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function views(n?: number): string {
  if (!n || n <= 0) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
}
