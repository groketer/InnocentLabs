"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AgentTask } from "@/lib/types";
import { STATUS_META, formatProgress, formatTime } from "@/lib/format";

interface Stats {
  active_tasks: number;
  completed_today: number;
  prospects_total: number;
  prospects_qualified: number;
  prospects_needs_review: number;
  active_sequences: number;
  emails_sent_today: number;
}

function StatBlock({
  value,
  label,
  href,
}: {
  value: number | string;
  label: string;
  href?: string;
}) {
  const content = (
    <div className="flex-1 px-5 py-4 first:pl-0 last:pr-0">
      <p className="text-3xl font-semibold tabular-nums text-white">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-white/40">{label}</p>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="flex-1 transition-opacity hover:opacity-80">
        {content}
      </Link>
    );
  }

  return content;
}

export function DashboardContent() {
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tasksRes, statsRes] = await Promise.all([
          fetch("/api/tasks?topLevelOnly=true&limit=20"),
          fetch("/api/stats"),
        ]);
        const tasksData = await tasksRes.json();
        const statsData = await statsRes.json();
        if (!tasksRes.ok) throw new Error(tasksData?.error || "Could not load tasks.");
        if (!cancelled) {
          setTasks(tasksData.tasks);
          if (statsRes.ok) setStats(statsData.stats);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load tasks.");
        }
      }
    }

    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const current = tasks?.find((t) => t.status === "RUNNING" || t.status === "QUEUED");
  const recent = tasks?.filter((t) => t.id !== current?.id).slice(0, 10) ?? [];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <h1 className="text-lg font-semibold text-white">Dashboard</h1>
      <p className="mt-1 text-xs text-white/40">
        Agent activity and current tasks across Innocent Labs.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {stats && (
        <div className="mt-6 flex flex-wrap divide-x divide-ink-700 rounded-md border border-ink-700 bg-ink-900">
          <StatBlock value={stats.active_tasks} label="Active tasks" />
          <StatBlock value={stats.completed_today} label="Completed today" />
          <StatBlock
            value={stats.prospects_total}
            label="Prospects found"
            href="/prospects"
          />
          <StatBlock
            value={stats.prospects_qualified}
            label="Qualified"
            href="/prospects?qualification_status=qualified"
          />
          <StatBlock
            value={stats.active_sequences}
            label="Sequences in flight"
            href="/follow-ups"
          />
          <StatBlock value={stats.emails_sent_today} label="Sent today" />
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Agent</h2>
        {!tasks ? (
          <p className="mt-2 text-sm text-white/40">Loading…</p>
        ) : current ? (
          <Link
            href={`/tasks/${current.id}`}
            className="mt-3 block rounded-lg border border-ink-700 bg-ink-900 p-5 transition-colors hover:border-emerald-500/40"
          >
            <div className={`flex items-center gap-2 text-sm font-medium ${STATUS_META[current.status].className}`}>
              <span>{STATUS_META[current.status].icon}</span>
              <span>{STATUS_META[current.status].label}</span>
            </div>
            <p className="mt-2 text-base font-semibold text-white">{current.title}</p>
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-white/40">Progress</p>
                <p className="text-white/80">
                  {formatProgress(current.progress_current, current.progress_total, current.progress_label)}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/40">Currently</p>
                <p className="text-white/80">{current.current_subtask ?? current.current_step ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Started</p>
                <p className="text-white/80">{formatTime(current.started_at)}</p>
              </div>
              <div>
                <p className="text-xs text-white/40">Last activity</p>
                <p className="text-white/80">{formatTime(current.last_activity_at)}</p>
              </div>
            </div>
          </Link>
        ) : (
          <p className="mt-3 rounded-lg border border-ink-700 bg-ink-900 p-5 text-sm text-white/40">
            No active task right now. Ask Innocent Intelligence to run something in{" "}
            <Link href="/intelligence" className="text-emerald-400 hover:underline">
              Intelligence
            </Link>
            .
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Recent Tasks</h2>
        {!tasks ? (
          <p className="mt-2 text-sm text-white/40">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="mt-2 text-sm text-white/40">No tasks yet.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-900 text-xs uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-t border-ink-700 hover:bg-white/[0.02]">
                    <td className="px-4 py-2">
                      <Link href={`/tasks/${t.id}`} className="text-white/80 hover:text-emerald-400">
                        {t.title}
                      </Link>
                    </td>
                    <td className={`px-4 py-2 ${STATUS_META[t.status].className}`}>
                      {STATUS_META[t.status].icon} {STATUS_META[t.status].label}
                    </td>
                    <td className="px-4 py-2 text-white/50">{formatTime(t.started_at)}</td>
                    <td className="px-4 py-2 text-white/50">{formatTime(t.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
