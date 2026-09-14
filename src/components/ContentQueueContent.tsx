"use client";

import { useEffect, useState } from "react";

interface ContentDraft {
  id: string;
  product_id: string | null;
  platform: string;
  content: string;
  status: "pending_approval" | "approved" | "rejected" | "published" | "failed";
  grounding_note: string | null;
  external_post_id: string | null;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

const STATUS_META: Record<ContentDraft["status"], { label: string; className: string }> = {
  pending_approval: { label: "Needs your review", className: "text-amber-400" },
  approved: { label: "Approved", className: "text-emerald-400" },
  rejected: { label: "Rejected", className: "text-white/40" },
  published: { label: "Published", className: "text-emerald-400" },
  failed: { label: "Could not publish", className: "text-red-400" },
};

export function ContentQueueContent() {
  const [drafts, setDrafts] = useState<ContentDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("pending_approval");
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});

  async function load() {
    setError(null);
    try {
      const url = statusFilter ? `/api/content-drafts?status=${statusFilter}` : "/api/content-drafts";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load drafts.");
      setDrafts(data.drafts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load drafts.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setNotice(null);
    try {
      const content = editedContent[id];
      const res = await fetch(`/api/content-drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(content !== undefined ? { content } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not update draft.");
      if (data.warning) {
        setNotice(`Approved, but not yet published: ${data.warning}`);
      } else {
        setNotice(action === "approve" ? "Approved and published." : "Rejected.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update draft.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (!drafts) {
    return <p className="text-sm text-white/40">Loading…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Content</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-white outline-none"
        >
          <option value="pending_approval">Needs your review</option>
          <option value="approved">Approved</option>
          <option value="published">Published</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Could not publish</option>
          <option value="">All</option>
        </select>
      </div>
      <p className="mt-1 text-xs text-white/40">
        Drafts the agent has written, grounded in each product&apos;s stored brief. Nothing is ever
        published without your explicit approval here.
      </p>

      {notice && (
        <p className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {notice}
        </p>
      )}

      {drafts.length === 0 ? (
        <p className="mt-6 text-sm text-white/40">Nothing here right now.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {drafts.map((d) => (
            <div key={d.id} className="rounded-md border border-ink-700 bg-ink-900 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-white/40">{d.platform}</span>
                <span className={`text-xs font-medium ${STATUS_META[d.status].className}`}>
                  {STATUS_META[d.status].label}
                </span>
              </div>

              <textarea
                defaultValue={d.content}
                onChange={(e) => setEditedContent((prev) => ({ ...prev, [d.id]: e.target.value }))}
                disabled={d.status !== "pending_approval" && d.status !== "approved"}
                rows={6}
                className="mt-3 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white/90 outline-none focus:border-emerald-500/40 disabled:opacity-60"
              />

              {d.grounding_note && (
                <p className="mt-2 text-[11px] text-white/30">Grounded in: {d.grounding_note}</p>
              )}
              {d.error_message && (
                <p className="mt-2 text-[11px] text-red-400">{d.error_message}</p>
              )}
              {d.external_post_id && (
                <p className="mt-2 text-[11px] text-white/30">Post ID: {d.external_post_id}</p>
              )}

              {(d.status === "pending_approval" || d.status === "approved") && (
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busyId === d.id}
                    onClick={() => act(d.id, "approve")}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    {d.status === "approved" ? "Retry publish" : "Approve & publish"}
                  </button>
                  <button
                    disabled={busyId === d.id}
                    onClick={() => act(d.id, "reject")}
                    className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
