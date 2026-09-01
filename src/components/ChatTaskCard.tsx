"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AgentTask } from "@/lib/types";
import { STATUS_META, formatProgress, formatTime } from "@/lib/format";

export function ChatTaskCard({ taskId }: { taskId: string }) {
  const [task, setTask] = useState<AgentTask | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setTask(data.task);
      } catch {
        // ignore — card just won't update this cycle
      }
    }

    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [taskId]);

  if (!task) {
    return (
      <div className="max-w-sm rounded-lg border border-ink-700 bg-ink-800 px-4 py-3 text-sm text-white/50">
        Loading task…
      </div>
    );
  }

  const meta = STATUS_META[task.status];

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="block max-w-sm rounded-lg border border-ink-700 bg-ink-800 px-4 py-3 transition-colors hover:border-emerald-500/40"
    >
      <div className={`flex items-center gap-2 text-sm font-medium ${meta.className}`}>
        <span>{meta.icon}</span>
        <span>{meta.label}</span>
      </div>
      <p className="mt-1 text-sm font-medium text-white">{task.title}</p>
      <p className="mt-1 text-xs text-white/50">
        {formatProgress(task.progress_current, task.progress_total, task.progress_label)}
        {task.current_subtask ? ` — currently: ${task.current_subtask}` : ""}
      </p>
      <p className="mt-1 text-xs text-white/30">
        Last activity: {formatTime(task.last_activity_at)}
      </p>
    </Link>
  );
}
