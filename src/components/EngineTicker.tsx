"use client";

import { useEffect } from "react";

/**
 * MILESTONE 3E — VERCEL.
 *
 * Locally, the task engine advances itself via an always-on setInterval
 * loop inside the long-lived `next dev`/`next start` process (see
 * src/lib/taskEngine/engine.ts). On Vercel there is no such process, so
 * something else has to call POST /api/tasks/tick periodically.
 *
 * This component is that "something else." It's mounted once in the root
 * layout, so it runs on every page for as long as the app is open in a
 * browser tab — mirroring the ~4s cadence of the original local loop.
 *
 * It intentionally does nothing when the tab isn't visible, to avoid
 * burning function invocations on a background tab nobody's looking at.
 * It's also a genuine no-op locally on `next dev`/`next start`: the
 * server-side loop already handles ticking there, and calling
 * /api/tasks/tick from here too is harmless (claimTask/claimSubtask make
 * ticking safe to call concurrently/repeatedly) but unnecessary — Vercel
 * is the environment this component actually matters for.
 *
 * This is a backstop, not a guarantee: on Vercel Hobby, a task only
 * progresses while a tab is open (or once a day via /api/cron/daily). See
 * the module doc comment in src/lib/taskEngine/engine.ts for the full
 * picture.
 */
const TICK_INTERVAL_MS = 4000;

export default function EngineTicker() {
  useEffect(() => {
    let cancelled = false;

    const tickOnce = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      fetch("/api/tasks/tick", { method: "POST" }).catch(() => {
        // Best-effort only — a missed tick just means the next poll
        // (agent-status/tasks, or the next tick interval) catches up.
      });
    };

    // Fire once immediately, then on the regular interval.
    tickOnce();
    const interval = setInterval(tickOnce, TICK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
