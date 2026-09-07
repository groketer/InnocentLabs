"use client";

import { useEffect, useState } from "react";
import { formatTimestamp } from "@/lib/format";
import type { Product } from "@/lib/types";
import type { ProductInsight } from "@/lib/models/insights";

type ProductWithSeo = Product & { seo_issues: string[] | null };

interface ProductDocument {
  id: string;
  filename: string;
  char_count: number;
  uploaded_at: string;
}

export function ProductsContent() {
  const [products, setProducts] = useState<ProductWithSeo[] | null>(null);
  const [insights, setInsights] = useState<Record<string, ProductInsight>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [editingGeo, setEditingGeo] = useState<Record<string, string>>({});
  const [editingKnowledge, setEditingKnowledge] = useState<Record<string, string>>({});
  const [documents, setDocuments] = useState<Record<string, ProductDocument[]>>({});
  const [expandedKnowledge, setExpandedKnowledge] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", url: "", category: "", description: "" });
  const [addingProduct, setAddingProduct] = useState(false);

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

  async function saveGeographicFocus(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geographic_focus: editingGeo[id] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save geographic targeting.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save geographic targeting.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleCampaignPaused(id: string, paused: boolean) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_paused: paused }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not update campaign status.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update campaign status.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteProduct(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? Any prospects linked to it are kept, just detached from this product. This can't be undone.`)) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not delete product.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete product.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveProduct(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/products/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not approve product.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve product.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateProduct() {
    setAddingProduct(true);
    setError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProduct),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create product.");
      setNewProduct({ name: "", url: "", category: "", description: "" });
      setShowAddForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create product.");
    } finally {
      setAddingProduct(false);
    }
  }

  async function saveSupplementaryKnowledge(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplementary_knowledge: editingKnowledge[id] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusyId(null);
    }
  }

  async function loadDocuments(productId: string) {
    try {
      const res = await fetch(`/api/products/${productId}/documents`);
      const data = await res.json();
      if (res.ok) {
        setDocuments((prev) => ({ ...prev, [productId]: data.documents }));
      }
    } catch {
      // Non-fatal — the panel just shows nothing until retried.
    }
  }

  async function toggleKnowledgePanel(productId: string) {
    if (expandedKnowledge === productId) {
      setExpandedKnowledge(null);
      return;
    }
    setExpandedKnowledge(productId);
    setDocError(null);
    await loadDocuments(productId);
  }

  async function handleDocUpload(productId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadingDoc(productId);
    setDocError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/products/${productId}/documents`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not upload document.");
      await loadDocuments(productId);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : "Could not upload document.");
    } finally {
      setUploadingDoc(null);
    }
  }

  async function handleDocDelete(productId: string, documentId: string) {
    try {
      const res = await fetch(`/api/products/${productId}/documents/${documentId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not delete document.");
      await loadDocuments(productId);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : "Could not delete document.");
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
        <div className="flex shrink-0 gap-2">
          <a
            href="/api/products/export"
            className="rounded-md border border-ink-600 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
          >
            Download CSV
          </a>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-medium text-ink-950 transition-opacity hover:opacity-90"
          >
            {showAddForm ? "Cancel" : "Add product"}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="mt-4 rounded-md border border-ink-700 bg-ink-900 p-4">
          <p className="text-xs text-white/40">
            A failsafe for adding a product directly — useful if something&apos;s
            wrong with innocent.co.ke&apos;s sync, or for a product that
            shouldn&apos;t go through marketplace discovery at all.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              placeholder="Product name"
              value={newProduct.name}
              onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
            <input
              placeholder="https://..."
              value={newProduct.url}
              onChange={(e) => setNewProduct({ ...newProduct, url: e.target.value })}
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
            <input
              placeholder="Category (optional)"
              value={newProduct.category}
              onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
            <input
              placeholder="Description (optional)"
              value={newProduct.description}
              onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
            />
          </div>
          <button
            disabled={addingProduct || !newProduct.name || !newProduct.url}
            onClick={handleCreateProduct}
            className="mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-50"
          >
            {addingProduct ? "Creating…" : "Create product"}
          </button>
        </div>
      )}

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
                    {p.campaign_paused && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                        Campaign paused
                      </span>
                    )}
                    {p.approval_status === "pending" && (
                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
                        Awaiting your approval
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

              <div className="mt-3">
                <label className="text-xs text-white/40">
                  Geographic targeting — a hard directive for prospecting, not just a preference
                </label>
                <textarea
                  placeholder='e.g. "Kenya first. Eastern Africa as a second priority once Kenya is well covered."'
                  defaultValue={p.geographic_focus ?? ""}
                  onChange={(e) =>
                    setEditingGeo((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/50"
                />
                {editingGeo[p.id] !== undefined &&
                  editingGeo[p.id] !== (p.geographic_focus ?? "") && (
                    <button
                      disabled={busyId === p.id}
                      onClick={() => saveGeographicFocus(p.id)}
                      className="mt-1 rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-ink-950 disabled:opacity-50"
                    >
                      Save targeting
                    </button>
                  )}
              </div>

              {p.approval_status === "pending" ? (
                <div className="mt-3 rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2">
                  <p className="text-xs text-sky-300">
                    Discovered as a listing on innocent.co.ke — since that marketplace is
                    open to anyone, this hasn&apos;t been confirmed as your own product
                    yet. It won&apos;t be prospected or marketed until approved.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={busyId === p.id}
                      onClick={() => handleApproveProduct(p.id)}
                      className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-ink-950 disabled:opacity-50"
                    >
                      Approve — this is my product
                    </button>
                    <button
                      disabled={busyId === p.id}
                      onClick={() => handleDeleteProduct(p.id, p.name)}
                      className="rounded-md border border-ink-600 px-3 py-1 text-xs text-white/60 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
                    >
                      Not mine — dismiss
                    </button>
                  </div>
                </div>
              ) : (
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
                  <button
                    disabled={busyId === p.id}
                    onClick={() => toggleCampaignPaused(p.id, !p.campaign_paused)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                      p.campaign_paused
                        ? "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                        : "border-ink-600 text-white/60 hover:border-amber-500/40 hover:text-amber-300"
                    }`}
                    title="Prospecting always continues regardless — this only affects whether outreach emails go out for this product"
                  >
                    {p.campaign_paused ? "Resume campaign sending" : "Pause campaign sending"}
                  </button>
                  <button
                    onClick={() => toggleKnowledgePanel(p.id)}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
                  >
                    {expandedKnowledge === p.id ? "Hide knowledge base" : "Knowledge base"}
                  </button>
                  <button
                    disabled={busyId === p.id}
                    onClick={() => handleDeleteProduct(p.id, p.name)}
                    className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/40 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              )}

              {expandedKnowledge === p.id && (
                <div className="mt-3 space-y-3 border-t border-ink-800 pt-3">
                  <div>
                    <label className="text-xs text-white/40">
                      Supplementary knowledge — gated or internal info the
                      agent can&apos;t find on its own, included directly
                      whenever it writes about this product
                    </label>
                    <textarea
                      placeholder="e.g. pricing tiers not on the website, upcoming features, internal positioning notes…"
                      defaultValue={p.supplementary_knowledge ?? ""}
                      onChange={(e) =>
                        setEditingKnowledge((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      rows={3}
                      className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-xs text-white outline-none focus:border-emerald-500/50"
                    />
                    {editingKnowledge[p.id] !== undefined &&
                      editingKnowledge[p.id] !== (p.supplementary_knowledge ?? "") && (
                        <button
                          disabled={busyId === p.id}
                          onClick={() => saveSupplementaryKnowledge(p.id)}
                          className="mt-1 rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-ink-950 disabled:opacity-50"
                        >
                          Save
                        </button>
                      )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-white/40">
                        Reference documents — the agent searches these for
                        passages relevant to each specific prospect (e.g.
                        a book, a spec sheet)
                      </label>
                      <label className="cursor-pointer rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:text-white">
                        {uploadingDoc === p.id ? "Uploading…" : "Upload"}
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt,.md"
                          className="hidden"
                          disabled={uploadingDoc === p.id}
                          onChange={(e) => handleDocUpload(p.id, e)}
                        />
                      </label>
                    </div>

                    {docError && (
                      <p className="mt-1 text-xs text-red-300">{docError}</p>
                    )}

                    <div className="mt-2 space-y-1">
                      {(documents[p.id] ?? []).length === 0 ? (
                        <p className="text-xs text-white/30">No documents uploaded yet.</p>
                      ) : (
                        (documents[p.id] ?? []).map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between rounded-md border border-ink-800 bg-white/[0.02] px-3 py-2 text-xs"
                          >
                            <span className="text-white/60">
                              {doc.filename}{" "}
                              <span className="text-white/30">
                                ({Math.round(doc.char_count / 1000)}k chars)
                              </span>
                            </span>
                            <button
                              onClick={() => handleDocDelete(p.id, doc.id)}
                              className="text-white/30 transition-colors hover:text-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
