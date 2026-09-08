import { NextResponse } from "next/server";
import { recordTickTimestamp, getLastTickInfo } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 3Z-6 — a direct, unambiguous diagnostic.
 *
 * Manually navigating Vercel's log UI to find one specific hidden
 * console line proved error-prone in practice — easy to click the wrong
 * entry as new ones stream in. This removes that ambiguity entirely: it
 * calls the exact same write tick() calls, in isolation, and reports
 * back precisely what happened — success with the new timestamp, or the
 * exact error if it failed. No log navigation required.
 */
export async function GET() {
  const before = await getLastTickInfo().catch(() => null);

  try {
    await recordTickTimestamp();
  } catch (error) {
    return NextResponse.json(
      {
        writeSucceeded: false,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        fullErrorString: JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
        before,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const after = await getLastTickInfo().catch(() => null);

  return NextResponse.json(
    {
      writeSucceeded: true,
      before,
      after,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
