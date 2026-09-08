import { NextResponse } from "next/server";
import { getLastTickInfo } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    return NextResponse.json({ ...info, interpretation });
  } catch (error) {
    console.error("[api/tick-status] GET failed:", error);
    return NextResponse.json({ error: "Could not check tick status." }, { status: 500 });
  }
}
