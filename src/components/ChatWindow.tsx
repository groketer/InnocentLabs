"use client";

import { useState, useRef, useEffect, FormEvent } from "react";
import { ChatTaskCard } from "./ChatTaskCard";
import { formatTimestamp } from "@/lib/format";
import type { ConversationSummary } from "@/lib/models/chat";

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
  const [isStartingNewChat, setIsStartingNewChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // MILESTONE 5U — CORRECTION: converted from a useRef to useState. A
  // ref doesn't trigger a re-render when it changes, which was fine for
  // the original "set once on mount, never switch" design — but a real,
  // confirmed bug depended on exactly that limitation: "New chat"
  // overwrote the single ID kept in localStorage, permanently losing
  // the only reference to the previous conversation's messages, even
  // though they were never actually deleted from the database. Needs
  // to be state now so the UI can react to switching between
  // conversations, not just starting new ones.
  const [conversationId, setConversationId] = useState<string>(() => {
    if (typeof window === "undefined") return `conv-${Date.now()}`;
    const STORAGE_KEY = "innocent-intelligence-conversation-id";
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `conv-${Date.now()}`;
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  });

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  function loadConversationList() {
    fetch("/api/chat/conversations")
      .then((res) => res.json())
      .then((data) => setConversations(Array.isArray(data.conversations) ? data.conversations : []))
      .catch(() => undefined);
  }

  function loadMessages(id: string) {
    fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data) => {
        setMessages(
          Array.isArray(data.messages) && data.messages.length > 0
            ? data.messages.map((m: ChatMessage & { id: string }) => ({
                role: m.role,
                content: m.content,
                timestamp: m.timestamp ?? (m as unknown as { created_at: string }).created_at,
              }))
            : [WELCOME_MESSAGE]
        );
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    loadMessages(conversationId);
    loadConversationList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchConversation(id: string) {
    const STORAGE_KEY = "innocent-intelligence-conversation-id";
    window.localStorage.setItem(STORAGE_KEY, id);
    setConversationId(id);
    loadMessages(id);
    setShowHistory(false);
  }

  async function handleNewChat() {
    setIsStartingNewChat(true);
    setError(null);
    try {
      // Summarize the outgoing conversation before it effectively goes
      // quiet — this is what future conversations pull in for
      // continuity. Never block starting the new chat on this succeeding.
      await fetch("/api/chat/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).catch(() => undefined);

      const STORAGE_KEY = "innocent-intelligence-conversation-id";
      const fresh =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `conv-${Date.now()}`;
      window.localStorage.setItem(STORAGE_KEY, fresh);
      setConversationId(fresh);
      setMessages([WELCOME_MESSAGE]);
      loadConversationList();
    } finally {
      setIsStartingNewChat(false);
    }
  }

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
          conversationId,
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
      <div className="relative flex items-center justify-between border-b border-ink-700 px-4 py-4 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold text-white">Intelligence</h1>
          <p className="text-xs text-white/40">
            Persists across visits — pick up where you left off, or start fresh below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
          >
            History
          </button>
          <button
            onClick={handleNewChat}
            disabled={isStartingNewChat}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
          >
            {isStartingNewChat ? "Starting…" : "New chat"}
          </button>
        </div>

        {showHistory && (
          <div className="absolute right-4 top-full z-10 mt-1 max-h-96 w-80 overflow-y-auto rounded-md border border-ink-600 bg-ink-900 py-2 shadow-lg sm:right-6">
            {conversations.length === 0 ? (
              <p className="px-4 py-3 text-xs text-white/40">No past conversations yet.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.conversation_id}
                  onClick={() => switchConversation(c.conversation_id)}
                  className={`block w-full px-4 py-2 text-left text-xs transition-colors hover:bg-ink-800 ${
                    c.conversation_id === conversationId ? "bg-ink-800 text-emerald-300" : "text-white/70"
                  }`}
                >
                  <div className="truncate">{c.title}</div>
                  <div className="mt-0.5 text-[10px] text-white/30">
                    {formatTimestamp(c.last_message_at)} · {c.message_count} message{c.message_count === 1 ? "" : "s"}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
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
        className="flex items-end gap-3 border-t border-ink-700 px-4 py-4 sm:px-6"
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
