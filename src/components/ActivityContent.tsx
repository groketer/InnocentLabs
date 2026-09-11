"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, ActivityEventType } from "@/lib/types";
import { formatTimestamp } from "@/lib/format";

const FILTERS: { label: string; types?: ActivityEventType[] }[] = [
  { label: "All" },
  {
    label: "Tasks",
    types: [
      "TASK_CREATED",
      "TASK_STARTED",
      "TASK_PAUSED",
      "TASK_RESUMED",
      "TASK_RETRYING",
      "TASK_CANCELLED",
      "TASK_COMPLETED",
      "TASK_COMPLETED_WITH_ISSUES",
      "TASK_RECOVERY",
    ],
  },
  { label: "Errors", types: ["TASK_FAILED", "SUBTASK_FAILED"] },
  {
    label: "Needs Input",
    types: ["TASK_NEEDS_INPUT", "USER_APPROVAL_REQUIRED"],
  },
];

const EVENT_ICON: Record<string, string> = {
  TASK_CREATED: "＋",
  TASK_STARTED: "▶",
  TASK_PAUSED: "⏸",
  TASK_RESUMED: "▶",
  TASK_RETRYING: "🔁",
  TASK_CANCELLED: "⏹",
  SUBTASK_STARTED: "▶",
  SUBTASK_COMPLETED: "✓",
  SUBTASK_FAILED: "✕",
  TASK_NEEDS_INPUT: "🔵",
  TASK_COMPLETED: "✓",
  TASK_COMPLETED_WITH_ISSUES: "⚠",
  TASK_FAILED: "🔴",
  USER_APPROVAL_REQUIRED: "🔵",
  TASK_RECOVERY: "↺",
};

const PAGE_SIZE = 30;

export function ActivityContent() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [filterIndex, setFilterIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const types = FILTERS[filterIndex].types;
        const params = new URLSearchParams();
        if (types) params.set("eventTypes", types.join(","));
        // Re-fetches everything currently "loaded" (however many pages
        // Load More has revealed) in one request on each periodic
        // refresh — simpler and avoids duplicate-entry bugs versus trying
        // to append incrementally across separate polls.
        params.set("limit", String(pageCount * PAGE_SIZE + 1));

        const res = await fetch(`/api/activity?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not load activity.");
        if (!cancelled) {
          const rows = data.activity as ActivityEvent[];
          // Fetched one extra row (see +1 above) purely to detect whether
          // there's more beyond the current page count, without it ever
          // being rendered.
          setHasMore(rows.length > pageCount * PAGE_SIZE);
          setEvents(rows.slice(0, pageCount * PAGE_SIZE));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load activity.");
        }
      }
    }

    load();
    // MILESTONE 3Z-3 — reduced from 5s, part of an app-wide load
    // reduction; see EngineTicker.tsx for the full reasoning.
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [filterIndex, pageCount]);

  function changeFilter(index: number) {
    setFilterIndex(index);
    setPageCount(1);
    setEvents(null);
  }

  async function loadMore() {
    setLoadingMore(true);
    setPageCount((p) => p + 1);
    // The effect above re-fetches with the new pageCount; loadingMore
    // just prevents double-clicks in the brief window before it resolves.
    setTimeout(() => setLoadingMore(false), 1000);
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <h1 className="text-lg font-semibold text-white">Activity</h1>
      <p className="mt-1 text-xs text-white/40">
        The chronological operational history of Innocent Intelligence.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            onClick={() => changeFilter(i)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filterIndex === i
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-ink-600 bg-ink-800 text-white/60 hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {!events ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-white/40">No activity yet.</p>
        ) : (
          <>
            {events.map((e) => (
              <div key={e.id} className="flex gap-3 border-b border-ink-800 pb-3">
                <span className="w-24 shrink-0 text-xs text-white/30">
                  {formatTimestamp(e.created_at)}
                </span>
                <span className="shrink-0">{EVENT_ICON[e.event_type] ?? "•"}</span>
                <div className="min-w-0">
                  <p className="text-sm text-white/80">{e.message}</p>
                  {e.task_id && (
                    <Link
                      href={`/tasks/${e.task_id}`}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      View task
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 w-full rounded-md border border-ink-700 bg-ink-900 py-2 text-xs text-white/50 transition-colors hover:text-white disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
