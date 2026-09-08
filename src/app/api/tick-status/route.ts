import { NextResponse } from "next/server";
import { getLastTickInfo } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MILESTONE 3Z-1 — dynamic = "force-dynamic" stops Next.js's own
// build-time/ISR caching, but doesn't add an explicit no-cache response
// header — meaning a browser (or an intermediary CDN) could still cache
// this GET response for some default duration. For a route whose entire
// purpose is showing truly live status, that's a real problem: an
// explicit header removes the ambiguity rather than relying on the
// framework default being sufficient.
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET() {
  try {
    const info = await getLastTickInfo();

    let interpretation: string;
    if (info.secondsAgo === null) {
      interpretation = "No tick has ever been recorded — something is wrong with even the daily cron.";
    } else if (info.secondsAgo < 5 * 60) {
      interpretation = "Recent — frequent external ticking (e.g. QStash) is very likely actually running.";
    } else if (info.secondsAgo < 60 * 60) {
      interpretation = "A while ago — frequent ticking may be misconfigured or intermittent.";
    } else {
      interpretation = "A long time ago — very likely only the once-daily cron is running, not frequent external ticking.";
    }

    return NextResponse.json({ ...info, interpretation }, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("[api/tick-status] GET failed:", error);
    return NextResponse.json({ error: "Could not check tick status." }, { status: 500, headers: NO_CACHE_HEADERS });
  }
}
