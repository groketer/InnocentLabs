"use client";

import { useEffect, useState } from "react";
import { formatTimestamp } from "@/lib/format";
import type { Product } from "@/lib/types";
import type { ProductInsight } from "@/lib/models/insights";

type ProductWithSeo = Product & { seo_issues: string[] | null };

export function ProductsContent() {
  const [products, setProducts] = useState<ProductWithSeo[] | null>(null);
  const [insights, setInsights] = useState<Record<string, ProductInsight>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  async function load() {
    try {
      const [productsRes, insightsRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/insights"),
      ]);
      const data = await productsRes.json();
      const insightsData = await insightsRes.json();
      if (!productsRes.ok) throw new Error(data?.error || "Could not load products.");
      setProducts(
        (data.products as ProductWithSeo[]).filter((p) => p.asset_type === "product")
      );
      if (insightsRes.ok) {
        const map: Record<string, ProductInsight> = {};
        for (const i of insightsData.insights as ProductInsight[]) {
          map[i.product_id] = i;
        }
        setInsights(map);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function trigger(id: string, kind: "audit" | "prospect") {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/products/${id}/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not start task.");
      setNotice(
        `${kind === "audit" ? "Audit" : "Prospecting"} task started — check the Dashboard for progress.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start task.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNotes(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: editingNotes[id] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save notes.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save notes.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Products</h1>
          <p className="mt-1 text-xs text-white/40">
            The Innocent Labs portfolio — what the agent strategizes on how to
            market. Prospects and outreach always target people and
            organizations outside this list, never anything shown here.
          </p>
        </div>
        <a
          href="/api/products/export"
          className="shrink-0 rounded-md border border-ink-600 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          Download CSV
        </a>
      </div>

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
        {!products ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : (
          products.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-ink-700 bg-ink-900 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white">{p.name}</p>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                      {p.category}
                    </span>
                    {p.status !== "active" && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                        {p.status}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-1 text-sm text-white/60">{p.description}</p>
                  )}
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-emerald-400 hover:underline"
                    >
                      {p.url}
                    </a>
                  )}
                </div>
              </div>

              {(p.problem || p.audience || p.positioning || p.cta) && (
                <div className="mt-3 grid gap-2 border-t border-ink-800 pt-3 text-xs text-white/50 sm:grid-cols-2">
                  {p.problem && (
                    <p><span className="text-white/30">Problem: </span>{p.problem}</p>
                  )}
                  {p.audience && (
                    <p><span className="text-white/30">Audience: </span>{p.audience}</p>
                  )}
                  {p.positioning && (
                    <p><span className="text-white/30">Positioning: </span>{p.positioning}</p>
                  )}
                  {p.cta && (
                    <p><span className="text-white/30">CTA: </span>{p.cta}</p>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/40">
                {p.last_audited_at ? (
                  <span>Last audited {formatTimestamp(p.last_audited_at)}</span>
                ) : (
                  <span>Never audited</span>
                )}
                {typeof p.confidence === "number" && (
                  <span>{Math.round(p.confidence * 100)}% confidence</span>
                )}
              </div>

              {insights[p.id] && insights[p.id].prospects_found > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-white/[0.02] px-3 py-2 text-xs text-white/50">
                  <span>{insights[p.id].prospects_found} found</span>
                  <span>→</span>
                  <span>{insights[p.id].qualified} qualified</span>
                  <span>→</span>
                  <span>{insights[p.id].emailed} emailed</span>
                  <span>→</span>
                  <span className={insights[p.id].replied > 0 ? "text-emerald-400" : ""}>
                    {insights[p.id].replied} replied
                  </span>
                  {insights[p.id].bounced > 0 && (
                    <span className="text-red-400">{insights[p.id].bounced} bounced</span>
                  )}
                  {insights[p.id].unsubscribed > 0 && (
                    <span className="text-white/30">{insights[p.id].unsubscribed} unsubscribed</span>
                  )}
                </div>
              )}

              {p.seo_issues && (
                <div className="mt-3 rounded-md border border-ink-800 bg-white/[0.02] px-3 py-2">
                  <p className="text-xs font-medium text-white/60">
                    {p.seo_issues.length === 0
                      ? "SEO: no significant issues found"
                      : `SEO: ${p.seo_issues.length} issue${p.seo_issues.length === 1 ? "" : "s"} found`}
                  </p>
                  {p.seo_issues.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-white/40">
                      {p.seo_issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="mt-3">
                <textarea
                  placeholder="Your own notes / strategy thinking for this product…"
                  defaultValue={p.notes ?? ""}
                  onChange={(e) =>
                    setEditingNotes((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                  rows={2}
                  className="w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/50"
                />
                {editingNotes[p.id] !== undefined &&
                  editingNotes[p.id] !== (p.notes ?? "") && (
                    <button
                      disabled={busyId === p.id}
                      onClick={() => saveNotes(p.id)}
                      className="mt-1 rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-ink-950 disabled:opacity-50"
                    >
                      Save notes
                    </button>
                  )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={busyId === p.id}
                  onClick={() => trigger(p.id, "audit")}
                  className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-40"
                >
                  Audit now
                </button>
                <button
                  disabled={busyId === p.id}
                  onClick={() => trigger(p.id, "prospect")}
                  className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-40"
                >
                  Prospect now
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
