"use client";

import { useEffect, useMemo, useState } from "react";
import { formatTimestamp } from "@/lib/format";
import type { Prospect } from "@/lib/models/prospects";

type SequenceWithProduct = Prospect & { product_name: string | null };

interface ConversationItem {
  id: string;
  at: string;
  from: "us" | "them";
  kind: "outbound" | "reply" | "bounce" | "auto_reply" | "unmatched";
  subject?: string;
  body?: string;
  status?: string;
  note?: string;
}

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
  in_conversation: { label: "In conversation (agent replying)", className: "text-emerald-400" },
  needs_human_reply: { label: "Needs your reply", className: "text-amber-400" },
  bounced: { label: "Bounced", className: "text-red-400" },
};

export function FollowUpsContent() {
  const [sequences, setSequences] = useState<SequenceWithProduct[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationItem[] | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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
    // MILESTONE 3Z-3 — reduced from 5s, part of an app-wide load
    // reduction; see EngineTicker.tsx for the full reasoning.
    const interval = setInterval(load, 20_000);
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

  async function toggleConversation(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setConversation(null);
      return;
    }

    setExpandedId(id);
    setConversation(null);
    setConversationError(null);

    try {
      const res = await fetch(`/api/followups/${id}/conversation`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load conversation.");
      setConversation(data.items);
    } catch (err) {
      setConversationError(
        err instanceof Error ? err.message : "Could not load conversation."
      );
    }
  }

  async function runNow() {
    setRunningNow(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/followups/run-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not run outreach now.");
      setNotice(
        "Outreach run triggered — check back in a few seconds for updates."
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run outreach now.");
    } finally {
      setRunningNow(false);
    }
  }

  const filteredSequences = useMemo(() => {
    if (!sequences) return sequences;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sequences;
    return sequences.filter((s) =>
      [s.name, s.organization, s.email]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    );
  }, [sequences, searchQuery]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Follow-ups</h1>
          <p className="mt-1 text-xs text-white/40">
            Outreach sequences in progress. Replies to replies@replies.prfed.com
            are detected automatically and handled by the agent — &quot;Mark
            Responded&quot; below is a manual override for edge cases (e.g. someone
            replies directly to your inbox instead).
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href="/api/followups/export"
            className="rounded-md border border-ink-600 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
          >
            Download CSV
          </a>
          <button
            onClick={runNow}
            disabled={runningNow}
            className="rounded-md border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
          >
            {runningNow ? "Running…" : "Run outreach now"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-white/30">
        On Vercel, outreach normally only runs once a day automatically.
        Use this to send right away instead of waiting — useful right after
        qualifying someone new.
      </p>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search name, organization, email…"
        className="mt-3 w-64 rounded-full border border-ink-600 bg-ink-800 px-3 py-1 text-xs text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none"
      />

      {notice && (
        <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {!filteredSequences ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : filteredSequences.length === 0 && sequences && sequences.length > 0 ? (
          <p className="text-sm text-white/40">No sequences match &quot;{searchQuery}&quot;.</p>
        ) : filteredSequences.length === 0 ? (
          <p className="text-sm text-white/40">
            No outreach sequences yet. These start automatically once a
            prospect is marked &quot;Qualified&quot; on the Prospects page.
          </p>
        ) : (
          filteredSequences.map((s) => (
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
                  s.sequence_status === "pending_approval" ||
                  s.sequence_status === "in_conversation") && (
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
                {["active", "pending_approval", "paused", "in_conversation", "needs_human_reply"].includes(
                  s.sequence_status
                ) && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "unsubscribe")}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
                    title="For anyone who couldn't use the link in their email — e.g. asked by reply or phone"
                  >
                    Unsubscribe manually
                  </button>
                )}
                {s.sequence_status === "needs_human_reply" && (
                  <button
                    disabled={busyId === s.id}
                    onClick={() => act(s.id, "mark_handled")}
                    className="rounded-md border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-40"
                    title="Once you've replied to them yourself from your own email"
                  >
                    Mark handled — I replied personally
                  </button>
                )}
                {s.emails_sent > 0 && (
                  <button
                    onClick={() => toggleConversation(s.id)}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:text-white"
                  >
                    {expandedId === s.id ? "Hide conversation" : "View conversation"}
                  </button>
                )}
              </div>

              {expandedId === s.id && (
                <div className="mt-4 space-y-3 border-t border-ink-700 pt-4">
                  {conversationError ? (
                    <p className="text-xs text-red-300">{conversationError}</p>
                  ) : !conversation ? (
                    <p className="text-xs text-white/40">Loading…</p>
                  ) : conversation.length === 0 ? (
                    <p className="text-xs text-white/40">Nothing recorded yet.</p>
                  ) : (
                    conversation.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-md border px-3 py-2 text-xs ${
                          item.from === "us"
                            ? "border-emerald-500/20 bg-emerald-500/5"
                            : "border-sky-500/20 bg-sky-500/5"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-white/40">
                          <span className="font-medium text-white/70">
                            {item.from === "us"
                              ? item.kind === "reply"
                                ? "You (autonomous reply)"
                                : "You (outreach)"
                              : item.kind === "bounce"
                                ? `${s.name} — bounced`
                                : item.kind === "auto_reply"
                                  ? `${s.name} — auto-responder (skipped)`
                                  : s.name}
                          </span>
                          <span>{formatTimestamp(item.at)}</span>
                        </div>
                        {item.subject && (
                          <p className="mt-1 font-medium text-white/80">{item.subject}</p>
                        )}
                        {item.body && (
                          <p className="mt-1 whitespace-pre-wrap text-white/60">
                            {item.body.slice(0, 1000)}
                          </p>
                        )}
                        {item.note && (
                          <p className="mt-1 text-white/40">Note: {item.note}</p>
                        )}
                        {item.status === "failed" && (
                          <p className="mt-1 text-red-300">Send failed.</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
