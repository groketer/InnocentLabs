"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface SearchResults {
  prospects: { id: string; name: string; organization: string | null; email: string | null }[];
  products: { id: string; name: string; category: string | null }[];
  tasks: { id: string; title: string; task_type: string; status: string }[];
}

const EMPTY_RESULTS: SearchResults = { prospects: [], products: [], tasks: [] };

/**
 * MILESTONE 4J — platform-wide search on the Dashboard.
 *
 * Complements the per-page searches on Prospects/Follow-ups/Products —
 * this one is for "I know it's in here somewhere, I just don't know
 * which page" moments, searching across entity types at once.
 */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setResults(EMPTY_RESULTS);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults({
          prospects: data.prospects ?? [],
          products: data.products ?? [],
          tasks: data.tasks ?? [],
        });
        setIsOpen(true);
      } catch {
        setResults(EMPTY_RESULTS);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasResults =
    results.prospects.length > 0 || results.products.length > 0 || results.tasks.length > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
        placeholder="Search prospects, products, tasks…"
        className="w-full rounded-full border border-ink-600 bg-ink-800 px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none"
      />

      {isOpen && (
        <div className="absolute z-40 mt-2 max-h-96 w-full overflow-y-auto rounded-md border border-ink-600 bg-ink-900 shadow-lg">
          {isLoading ? (
            <p className="px-4 py-3 text-xs text-white/40">Searching…</p>
          ) : !hasResults ? (
            <p className="px-4 py-3 text-xs text-white/40">No results for &quot;{query}&quot;.</p>
          ) : (
            <>
              {results.prospects.length > 0 && (
                <div className="border-b border-ink-700 py-2">
                  <p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-wide text-white/30">
                    Prospects
                  </p>
                  {results.prospects.map((p) => (
                    <Link
                      key={p.id}
                      href="/prospects"
                      onClick={() => setIsOpen(false)}
                      className="block px-4 py-1.5 text-sm text-white/80 hover:bg-ink-800"
                    >
                      {p.name}
                      {p.organization && (
                        <span className="text-white/40"> — {p.organization}</span>
                      )}
                    </Link>
                  ))}
                </div>
              )}

              {results.products.length > 0 && (
                <div className="border-b border-ink-700 py-2">
                  <p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-wide text-white/30">
                    Products
                  </p>
                  {results.products.map((p) => (
                    <Link
                      key={p.id}
                      href="/products"
                      onClick={() => setIsOpen(false)}
                      className="block px-4 py-1.5 text-sm text-white/80 hover:bg-ink-800"
                    >
                      {p.name}
                      {p.category && <span className="text-white/40"> — {p.category}</span>}
                    </Link>
                  ))}
                </div>
              )}

              {results.tasks.length > 0 && (
                <div className="py-2">
                  <p className="px-4 pb-1 text-[10px] font-medium uppercase tracking-wide text-white/30">
                    Tasks
                  </p>
                  {results.tasks.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      onClick={() => setIsOpen(false)}
                      className="block px-4 py-1.5 text-sm text-white/80 hover:bg-ink-800"
                    >
                      {t.title}
                      <span className="text-white/40"> — {t.status}</span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
