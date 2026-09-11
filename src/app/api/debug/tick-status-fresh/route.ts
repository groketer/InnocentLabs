import { NextResponse } from "next/server";
import { getLastTickInfo } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * MILESTONE 4X — calls the exact same getLastTickInfo() as
 * /api/tick-status, but from a route that has never been invoked
 * before. If this shows fresh data while /api/tick-status stays
 * frozen on its old value, that isolates the staleness to something
 * about that specific, long-lived route rather than the underlying
 * query or data — consistent with a documented Next.js 14 pattern
 * where a third-party library's internal fetch() call gets cached on
 * a route's first invocation and never revalidates, even with
 * dynamic = "force-dynamic" set.
 */
export async function GET() {
  const info = await getLastTickInfo();
  return NextResponse.json(
    { ...info, calledFrom: "tick-status-fresh (new route)", serverTimestamp: new Date().toISOString() },
    { headers: NO_CACHE_HEADERS }
  );
}
