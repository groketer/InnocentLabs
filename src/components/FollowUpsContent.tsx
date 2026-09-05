"use client";

import { useEffect, useState } from "react";
import { formatTimestamp } from "@/lib/format";
import type { Prospect } from "@/lib/models/prospects";

type SequenceWithProduct = Prospect & { product_name: string | null };

const STATUS_META: Record<
  Prospect["sequence_status"],
  { label: string; className: string }
> = {
  not_started: { label: "Not started", className: "text-white/40" },
  pending_approval: { label: "Needs your approval", className: "text-amber-400" },
  active: { label: "Active", className: "text-emerald-400" },
  completed: { label: "Completed", className: "text-white/40" },
  unsubscribed: { label: "Unsubscribed", className: "text-red-400" },
  responded: { label: "Responded", className: "text-sky-400" },
  paused: { label: "Paused", className: "text-white/40" },
};

export function FollowUpsContent() {
  const [sequences, setSequences] = useState<SequenceWithProduct[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/followups");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load follow-ups.");
      setSequences(data.sequences);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load follow-ups.");
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function act(id: string, action: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not update sequence.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update sequence.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <h1 className="text-lg font-semibold text-white">Follow-ups</h1>
      <p className="mt-1 text-xs text-white/40">
        Outreach sequences in progress. Replies can&apos;t be detected
        automatically — mark someone &quot;Responded&quot; here once you see
        their reply in your own inbox, and their sequence stops.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {!sequences ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : sequences.length === 0 ? (
          <p className="text-sm text-white/40">
            No outreach sequences yet. These start automatically once a
            prospect is marked &quot;Qualified&quot; on the Prospects page.
          </p>
        ) : (
          sequences.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-ink-700 bg-ink-900 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{s.name}</p>
                  {(s.organization || s.role) && (
                    <p className="mt-0.5 text-xs text-white/50">
                      {[s.role, s.organization].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${STATUS_META[s.sequence_status].className}`}
                >
                  {STATUS_META[s.sequence_status].label}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
                <span>{s.email}</span>
                {s.product_name && <span>For {s.product_name}</span>}
                <span>{s.emails_sent} email{s.emails_sent === 1 ? "" : "s"} sent</span>
                {s.last_sent_at && <span>Last sent {formatTimestamp(s.last_sent_at)}</span>}
                {s.next_send_at && s.sequence_status === "active" && (
                  <span>Next send {formatTimestamp(s.next_send_at)}</span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {s.sequence_status === "pending_approval" && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "approve")}
                    className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-40"
                  >
                    Approve — send on next outreach run
                  </button>
                )}
                {(s.sequence_status === "active" ||
                  s.sequence_status === "pending_approval") && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "mark_responded")}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-sky-500/40 hover:text-sky-300 disabled:opacity-40"
                  >
                    Mark responded
                  </button>
                )}
                {s.sequence_status === "active" && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "pause")}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:text-white disabled:opacity-40"
                  >
                    Pause
                  </button>
                )}
                {s.sequence_status === "paused" && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "resume")}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:text-white disabled:opacity-40"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
