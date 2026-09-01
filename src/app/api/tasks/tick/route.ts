import { NextResponse } from "next/server";
import { tick } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";

/**
 * Dev/testing convenience only: the engine already ticks on its own every
 * few seconds (see src/lib/taskEngine/engine.ts). This route lets you
 * force one extra tick immediately instead of waiting, which is useful
 * while testing. It is not required for the engine to function and is
 * safe to call repeatedly — a tick is a no-op if there's nothing active.
 */
export async function POST() {
  try {
    await tick();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tasks/tick] failed:", error);
    return NextResponse.json({ error: "Tick failed." }, { status: 500 });
  }
}
