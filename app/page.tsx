"use client";

import { useState } from "react";
import type { FeedPlan, FeedStreamEvent, RankedItem, Source } from "@/lib/types";

const WINDOWS: { label: string; hours: number }[] = [
  { label: "24h", hours: 24 },
  { label: "Week", hours: 24 * 7 },
  { label: "2 weeks", hours: 24 * 14 },
  { label: "Month", hours: 24 * 30 },
];

const EXAMPLE = "New open-source LLM releases and serious AI-agent research from the past week";
const TOP_EXPLAIN = 10; // matches the server; items beyond this won't get a "why"

const SOURCE_STYLES: Record<Source, { label: string; cls: string }> = {
  youtube: { label: "YouTube", cls: "bg-red-100 text-red-700" },
  hn: { label: "Hacker News", cls: "bg-orange-100 text-orange-700" },
  reddit: { label: "Reddit", cls: "bg-amber-100 text-amber-700" },
  x: { label: "X", cls: "bg-neutral-200 text-neutral-800" },
};

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
  const [windowHours, setWindowHours] = useState(24 * 7);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<FeedPlan | null>(null);
  const [items, setItems] = useState<RankedItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const loading = phase === "planning" || phase === "ranking" || phase === "explaining";

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
        body: JSON.stringify({ prompt: q, windowHours }),
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Custom Feed</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Describe what you want to follow. An agent searches recent posts and ranks them by relevance.
        </p>
      </header>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") buildFeed();
          }}
          rows={3}
          placeholder={`e.g. "${EXAMPLE}"`}
          className="w-full resize-none rounded-lg border border-neutral-300 bg-white p-3 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-neutral-500">Recency:</span>
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                onClick={() => setWindowHours(w.hours)}
                className={`rounded-full px-2.5 py-1 ${
                  windowHours === w.hours
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-black"
                    : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            onClick={buildFeed}
            disabled={loading || !prompt.trim()}
            className="ml-auto rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Building…" : "Build feed"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">Tip: ⌘/Ctrl + Enter to build.</p>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {(plan || items.length > 0) && (
        <section className="mt-8">
          {plan?.refinedInterest && (
            <p className="mb-1 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <span>
                Showing: <span className="font-medium">{plan.refinedInterest}</span>
              </span>
              {loading && PHASE_LABEL[phase] && (
                <span className="text-xs text-neutral-400">· {PHASE_LABEL[phase]}</span>
              )}
            </p>
          )}
          {warnings.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {items.length > 0 ? (
            <ul className="space-y-3">
              {items.map((item, i) => (
                <FeedCard
                  key={item.id}
                  item={item}
                  pendingWhy={phase === "explaining" && i < TOP_EXPLAIN && !item.why}
                />
              ))}
            </ul>
          ) : phase === "done" ? (
            <p className="text-sm text-neutral-500">
              No matching posts found. Try a broader interest or a longer window.
            </p>
          ) : (
            <FeedSkeleton />
          )}
        </section>
      )}

      {/* Initial loading (before the plan arrives) */}
      {phase === "planning" && !plan && <FeedSkeleton />}
    </main>
  );
}

function FeedCard({ item, pendingWhy }: { item: RankedItem; pendingWhy: boolean }) {
  const src = SOURCE_STYLES[item.source];
  return (
    <li className="rounded-xl border border-neutral-200 p-3 transition hover:border-neutral-300 dark:border-neutral-800">
      <div className="flex gap-3">
        {item.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail}
            alt=""
            className="h-[68px] w-[120px] shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${src.cls}`}>
              {src.label}
            </span>
            <span
              className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
              title="Relevance score"
            >
              {item.score}
            </span>
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 font-medium leading-snug hover:underline"
          >
            {item.title}
          </a>
          {item.why ? (
            <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
              {item.why}
            </p>
          ) : pendingWhy ? (
            <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          ) : null}
          <div className="mt-1 text-[11px] text-neutral-400">
            {[item.author, timeAgo(item.publishedAt), views(item.engagement)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
    </li>
  );
}

function FeedSkeleton() {
  return (
    <div className="mt-4 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
        >
          <div className="h-[68px] w-[120px] shrink-0 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        </div>
      ))}
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
