"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { ChatTaskCard } from "./ChatTaskCard";
import { formatTimestamp } from "@/lib/format";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  taskIds?: string[];
}

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Hi, I'm Innocent Intelligence — your business-development partner for the Innocent Labs ecosystem. Ask me what I know about Innocent, Innocent Labs, or the current product portfolio, and I'll tell you honestly what I do and don't know yet.",
  timestamp: new Date().toISOString(),
};

export function ChatWindow() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `conv-${Date.now()}`
  );

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    fetch(`/api/chat?conversationId=${encodeURIComponent(conversationIdRef.current)}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages.map((m: ChatMessage & { id: string }) => ({
            role: m.role, content: m.content, timestamp: m.timestamp ?? (m as unknown as { created_at: string }).created_at,
          })));
        }
      })
      .catch(() => undefined);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: trimmed, timestamp: new Date().toISOString() };
    // conversation continuity for this browser session (not persisted)
    const nextHistory = [...messages, userMessage];

    setMessages(nextHistory);
    setInput("");
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: messages, // everything before this new user message
          conversationId: conversationIdRef.current,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "The request failed.");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply as string,
          timestamp: new Date().toISOString(),
          taskIds: Array.isArray(data.tasksCreated)
            ? data.tasksCreated.map((t: { taskId: string }) => t.taskId)
            : undefined,
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="border-b border-ink-700 px-6 py-4">
        <h1 className="text-lg font-semibold text-white">Intelligence</h1>
        <p className="text-xs text-white/40">
          Conversational session — not saved between browser reloads yet.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.map((m, i) => (
          <div key={i} className="space-y-2">
            <MessageBubble message={m} />
            {m.taskIds?.map((taskId) => (
              <div key={taskId} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <ChatTaskCard taskId={taskId} />
              </div>
            ))}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-white/40">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 [animation-delay:300ms]" />
            <span>Innocent Intelligence is thinking…</span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-3 border-t border-ink-700 px-6 py-4"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          rows={1}
          placeholder="Ask Innocent Intelligence something…"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isLoading || input.trim().length === 0}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-4 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-emerald-500 text-ink-950"
            : "bg-ink-800 text-white/90 border border-ink-700"
        }`}
      >
        {message.content}
        <div className={`mt-1 text-[10px] ${isUser ? "text-ink-950/60" : "text-white/30"}`}>
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
