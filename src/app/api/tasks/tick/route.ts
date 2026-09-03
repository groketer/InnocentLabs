import { NextResponse } from "next/server";
import { tick } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";

/**
 * Locally, this is a dev/testing convenience only — the engine already
 * ticks on its own every few seconds via the in-process setInterval loop
 * (see src/lib/taskEngine/engine.ts).
 *
 * On Vercel, there IS no in-process loop (serverless functions can't keep
 * one alive), so this route is load-bearing: it's what the client-side
 * EngineTicker (see src/components/EngineTicker.tsx) calls every few
 * seconds while the app is open to actually advance tasks. It's also hit
 * once daily by /api/cron/daily as a backstop.
 *
 * Safe to call repeatedly/concurrently — claimTask/claimSubtask make task
 * claiming atomic, so overlapping callers can never double-advance the
 * same task. A tick is a no-op if nothing is active.
 *
 * maxDuration: a single tick does at most one real unit of work (e.g. one
 * subtask's web research call), which can take a while. Verify this
 * against your current Vercel plan's actual limit before deploying —
 * documented limits vary by plan and have changed over time.
 */
export const maxDuration = 60;

export async function POST() {
  try {
    await tick();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tasks/tick] failed:", error);
    return NextResponse.json({ error: "Tick failed." }, { status: 500 });
  }
}
