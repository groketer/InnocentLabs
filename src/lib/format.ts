import type { TaskStatus } from "@/lib/types";

/** Formats an ISO timestamp in the viewer's local timezone, e.g. "Aug 24, 2026 · 7:42 PM". */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

/** Formats just the time, e.g. "7:49 PM" — used in dense feeds/tables. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: string; className: string }
> = {
  QUEUED: { label: "Queued", icon: "⏳", className: "text-white/50" },
  RUNNING: { label: "Working", icon: "🟢", className: "text-emerald-400" },
  PAUSED: { label: "Paused", icon: "🟡", className: "text-amber-400" },
  RETRYING: { label: "Retrying", icon: "🔁", className: "text-amber-400" },
  NEEDS_INPUT: { label: "Needs your input", icon: "🔵", className: "text-sky-400" },
  COMPLETED: { label: "Completed", icon: "✓", className: "text-emerald-400" },
  COMPLETED_WITH_ISSUES: { label: "Completed with issues", icon: "⚠", className: "text-amber-400" },
  FAILED: { label: "Failed", icon: "🔴", className: "text-red-400" },
  CANCELLED: { label: "Cancelled", icon: "⏹", className: "text-white/40" },
};

/** A meaningful progress string. Never a fabricated percentage — see engine.ts. */
export function formatProgress(
  current: number,
  total: number | null,
  label?: string | null
): string {
  if (label) return label;
  if (total === null || total === undefined) return "Working";
  if (total === 0) return "Nothing to do";
  return `${current} of ${total} complete`;
}
