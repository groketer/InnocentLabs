"use client";

import { useEffect, useState } from "react";

interface AgentQuestion {
  id: string;
  question: string;
  created_at: string;
}

interface AgentSuggestion {
  id: string;
  suggestion: string;
  created_at: string;
}

/**
 * MILESTONE 4T — full autonomy mode: surfaces what the agent's product
 * study found, right where Innocent already looks for things needing
 * attention.
 */
export function AgentQuestionsAndSuggestions() {
  const [questions, setQuestions] = useState<AgentQuestion[] | null>(null);
  const [suggestions, setSuggestions] = useState<AgentSuggestion[] | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const [qRes, sRes] = await Promise.all([
        fetch("/api/agent-questions"),
        fetch("/api/agent-suggestions"),
      ]);
      const qData = await qRes.json();
      const sData = await sRes.json();
      setQuestions(qData.questions ?? []);
      setSuggestions(sData.suggestions ?? []);
    } catch {
      // Silent — this is a supplementary section, not core functionality.
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function submitAnswer(id: string) {
    const answer = (answerDrafts[id] ?? "").trim();
    if (!answer) return;
    setBusyId(id);
    try {
      await fetch(`/api/agent-questions/${id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      setQuestions((prev) => (prev ? prev.filter((q) => q.id !== id) : prev));
      setAnswerDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/agent-suggestions/${id}/dismiss`, { method: "POST" });
      setSuggestions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } finally {
      setBusyId(null);
    }
  }

  const hasQuestions = questions && questions.length > 0;
  const hasSuggestions = suggestions && suggestions.length > 0;

  if (!hasQuestions && !hasSuggestions) return null;

  return (
    <div className="mt-6 space-y-3">
      {hasQuestions && (
        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-white/40">
            Questions from product study
          </p>
          <div className="mt-2 space-y-3">
            {questions!.map((q) => (
              <div key={q.id} className="rounded-md border border-ink-700 bg-ink-800 p-3">
                <p className="text-sm text-white/80">{q.question}</p>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={answerDrafts[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswerDrafts({ ...answerDrafts, [q.id]: e.target.value })
                    }
                    placeholder="Your answer…"
                    className="flex-1 rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-xs text-white placeholder:text-white/30"
                  />
                  <button
                    disabled={busyId === q.id || !(answerDrafts[q.id] ?? "").trim()}
                    onClick={() => submitAnswer(q.id)}
                    className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    Answer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasSuggestions && (
        <div className="rounded-md border border-ink-700 bg-ink-900 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-white/40">
            Suggestions from product study
          </p>
          <div className="mt-2 space-y-2">
            {suggestions!.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-md border border-ink-700 bg-ink-800 p-3"
              >
                <p className="text-sm text-white/80">{s.suggestion}</p>
                <button
                  disabled={busyId === s.id}
                  onClick={() => dismiss(s.id)}
                  className="shrink-0 rounded-md border border-ink-600 px-2 py-1 text-xs text-white/50 hover:text-white disabled:opacity-40"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
