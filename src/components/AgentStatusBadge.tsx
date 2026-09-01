"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AgentStatus, AgentStatusState } from "@/lib/models/agentStatus";

const STATE_STYLE: Record<AgentStatusState, { icon: string; className: string }> = {
  WORKING: { icon: "🟢", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  POSSIBLY_STALLED: { icon: "🟠", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  NEEDS_INPUT: { icon: "🔵", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  PAUSED: { icon: "🟡", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  ERROR: { icon: "🔴", className: "border-red-500/30 bg-red-500/10 text-red-300" },
  COMPLETED: { icon: "✓", className: "border-white/10 bg-white/5 text-white/60" },
  IDLE: { icon: "•", className: "border-white/10 bg-white/5 text-white/40" },
};

export function AgentStatusBadge() {
  const [status, setStatus] = useState<AgentStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/agent-status");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStatus(data.status);
      } catch {
        // silent — status badge just stays at its last known value
      }
    }

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!status) return null;

  const style = STATE_STYLE[status.state];
  const content = (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${style.className}`}
      title={status.label}
    >
      <span>{style.icon}</span>
      <span className="max-w-[220px] truncate">{status.label}</span>
    </div>
  );

  if (status.task) {
    return <Link href={`/tasks/${status.task.id}`}>{content}</Link>;
  }

  return content;
}
