"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatTimestamp } from "@/lib/format";
import type {
  Prospect,
  ProspectQualificationStatus,
} from "@/lib/models/prospects";

type ProspectWithProduct = Prospect & { product_name: string | null };

const STATUS_FILTERS: {
  label: string;
  value?: ProspectQualificationStatus;
}[] = [
  { label: "All" },
  { label: "Needs review", value: "needs_review" },
  { label: "Candidate", value: "candidate" },
  { label: "Qualified", value: "qualified" },
  { label: "Not a fit", value: "unqualified" },
];

const STATUS_META: Record<
  ProspectQualificationStatus,
  { label: string; className: string }
> = {
  candidate: { label: "Candidate", className: "text-white/50" },
  needs_review: { label: "Needs review", className: "text-sky-400" },
  qualified: { label: "Qualified", className: "text-emerald-400" },
  unqualified: { label: "Not a fit", className: "text-white/30" },
};

const TYPE_LABEL: Record<string, string> = {
  person: "Person",
  organization: "Organization",
  partner: "Partner",
  investor: "Investor",
  customer: "Customer",
  publisher: "Publisher",
  other: "Other",
};

export function ProspectsContent() {
  const [prospects, setProspects] = useState<ProspectWithProduct[] | null>(
    null
  );
  const [filterIndex, setFilterIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    try {
      const value = STATUS_FILTERS[filterIndex].value;
      const qs = value ? `?qualification_status=${value}` : "";
      const res = await fetch(`/api/prospects${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load prospects.");
      setProspects(data.prospects);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load prospects."
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterIndex]);

  async function setStatus(
    id: string,
    status: ProspectQualificationStatus
  ) {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qualification_status: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not update prospect.");

      setProspects((prev) =>
        prev
          ? prev.map((p) =>
              p.id === id ? { ...p, qualification_status: status } : p
            )
          : prev
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update prospect."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <h1 className="text-lg font-semibold text-white">Prospects</h1>
      <p className="mt-1 text-xs text-white/40">
        People and organizations discovered through research, with the
        evidence behind each one.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f, i) => (
          <button
            key={f.label}
            onClick={() => setFilterIndex(i)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filterIndex === i
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-ink-600 bg-ink-800 text-white/60 hover:text-white"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {!prospects ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : prospects.length === 0 ? (
          <p className="text-sm text-white/40">
            No prospects yet. Prospects show up here once a prospecting task
            finds and evidences them —{" "}
            <Link href="/" className="text-emerald-400 hover:underline">
              start one from the dashboard
            </Link>
            .
          </p>
        ) : (
          prospects.map((p) => (
            <div
              key={p.id}
              className="rounded-md border border-ink-700 bg-ink-900 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-white">{p.name}</p>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                      {TYPE_LABEL[p.prospect_type] ?? p.prospect_type}
                    </span>
                  </div>
                  {(p.organization || p.role) && (
                    <p className="mt-0.5 text-xs text-white/50">
                      {[p.role, p.organization].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${
                    STATUS_META[p.qualification_status].className
                  }`}
                >
                  {STATUS_META[p.qualification_status].label}
                </span>
              </div>

              {p.fit_reason && (
                <p className="mt-2 text-sm text-white/70">{p.fit_reason}</p>
              )}

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
                {p.email ? (
                  <span className="text-white/60">{p.email}</span>
                ) : (
                  <span>No public email found</span>
                )}
                {p.product_name && <span>For {p.product_name}</span>}
                {typeof p.confidence === "number" && (
                  <span>{Math.round(p.confidence * 100)}% confidence</span>
                )}
                <span>{formatTimestamp(p.created_at)}</span>
              </div>

              {(p.website || p.public_profile_url) && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {p.website && (
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline"
                    >
                      Website
                    </a>
                  )}
                  {p.public_profile_url && (
                    <a
                      href={p.public_profile_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline"
                    >
                      Public profile
                    </a>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    "qualified",
                    "needs_review",
                    "unqualified",
                  ] as ProspectQualificationStatus[]
                )
                  .filter((s) => s !== p.qualification_status)
                  .map((s) => (
                    <button
                      key={s}
                      disabled={updatingId === p.id}
                      onClick={() => setStatus(p.id, s)}
                      className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-white/60 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-40"
                    >
                      Mark {STATUS_META[s].label.toLowerCase()}
                    </button>
                  ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
