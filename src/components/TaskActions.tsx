"use client";

import { useState } from "react";
import type { AgentTask, AgentTaskWithChildren } from "@/lib/types";

interface Props {
  task: AgentTask;
  onChanged?: () => void;
}

async function callAction(taskId: string, action: string) {
  const res = await fetch(`/api/tasks/${taskId}/${action}`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Could not ${action} task.`);
  return data.task as AgentTask;
}

export function TaskActions({ task, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: string) {
    setBusy(action);
    setError(null);
    try {
      await callAction(task.id, action);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const buttons: { action: string; label: string; show: boolean }[] = [
    { action: "pause", label: "Pause", show: task.status === "RUNNING" || task.status === "QUEUED" },
    { action: "resume", label: "Resume", show: task.status === "PAUSED" || task.status === "NEEDS_INPUT" },
    {
      action: "retry",
      label: "Retry failed items",
      show:
        task.status === "FAILED" ||
        (task.status === "COMPLETED" &&
          "subtasks" in task &&
          (task as AgentTaskWithChildren).subtasks.some((s) => s.status === "FAILED")),
    },
    {
      action: "cancel",
      label: "Cancel",
      show: !["COMPLETED", "FAILED", "CANCELLED"].includes(task.status),
    },
  ];

  const visible = buttons.filter((b) => b.show);
  if (visible.length === 0 && !error) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((b) => (
        <button
          key={b.action}
          onClick={() => handle(b.action)}
          disabled={busy !== null}
          className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:border-emerald-500/50 hover:text-white disabled:opacity-40"
        >
          {busy === b.action ? "…" : b.label}
        </button>
      ))}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
