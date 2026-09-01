"use client";

import { useEffect, useState, useCallback } from "react";
import type { AgentTaskWithChildren, ActivityEvent } from "@/lib/types";
import { STATUS_META, formatProgress, formatTimestamp } from "@/lib/format";
import { TaskActions } from "./TaskActions";

export function TaskDetailContent({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AgentTaskWithChildren | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load task.");
      setTask(data.task);
      setActivity(data.activity);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load task.");
    }
  }, [taskId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  if (error) {
    return (
      <div className="flex-1 px-6 py-6">
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex-1 px-6 py-6 text-sm text-white/40">Loading…</div>
    );
  }

  const meta = STATUS_META[task.status];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className={`flex items-center gap-2 text-sm font-medium ${meta.className}`}>
        <span>{meta.icon}</span>
        <span>{meta.label}</span>
      </div>
      <h1 className="mt-1 text-xl font-semibold text-white">{task.title}</h1>
      {task.description && (
        <p className="mt-1 text-sm text-white/50">{task.description}</p>
      )}

      <div className="mt-4">
        <TaskActions task={task} onChanged={load} />
      </div>

      {task.error_message && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {task.error_message}
        </div>
      )}
      {task.result_summary && (
        <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {task.result_summary}
        </div>
      )}
      {task.result_json && (
        <details className="mt-4 rounded-md border border-ink-700 bg-ink-900 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-white/70">Structured evidence</summary>
          <pre className="mt-3 overflow-x-auto text-xs text-white/60">{formatResult(task.result_json)}</pre>
        </details>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-ink-700 bg-ink-900 p-5 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-white/40">Started</p>
          <p className="text-white/80">{formatTimestamp(task.started_at)}</p>
        </div>
        <div>
          <p className="text-xs text-white/40">Last activity</p>
          <p className="text-white/80">{formatTimestamp(task.last_activity_at)}</p>
        </div>
        <div>
          <p className="text-xs text-white/40">Progress</p>
          <p className="text-white/80">
            {formatProgress(task.progress_current, task.progress_total, task.progress_label)}
          </p>
        </div>
        <div>
          <p className="text-xs text-white/40">Completed</p>
          <p className="text-white/80">{formatTimestamp(task.completed_at)}</p>
        </div>
      </div>

      {task.current_step && (
        <p className="mt-4 text-sm text-white/60">
          <span className="text-white/40">Current step: </span>
          {task.current_step}
        </p>
      )}

      {task.subtasks.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-white/70">Subtasks</h2>
          <div className="mt-3 space-y-1.5">
            {task.subtasks.map((s) => {
              const sMeta = STATUS_META[s.status];
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className={sMeta.className}>{sMeta.icon}</span>
                    <span className="text-white/80">{s.title}</span>
                  </div>
                  <span className={`text-xs ${sMeta.className}`}>
                    {s.result_summary ?? s.error_message ?? sMeta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-white/70">Activity</h2>
        <div className="mt-3 space-y-2">
          {activity.length === 0 ? (
            <p className="text-sm text-white/40">No activity recorded yet.</p>
          ) : (
            activity.map((e) => (
              <div key={e.id} className="flex gap-3 border-b border-ink-800 pb-2">
                <span className="w-24 shrink-0 text-xs text-white/30">
                  {formatTimestamp(e.created_at)}
                </span>
                <span className="text-sm text-white/70">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function formatResult(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
