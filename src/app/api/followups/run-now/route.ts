import { NextResponse } from "next/server";
import { ensureDailyEmailCampaignTask } from "@/lib/taskEngine/emailCampaignScheduler";
import { tick } from "@/lib/taskEngine/engine";
import { getSettings } from "@/lib/models/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual escape hatch for exactly the situation this was built for: on
 * Vercel, the daily outreach task is normally only ever created once a day
 * by /api/cron/daily. If someone qualifies a prospect after that day's
 * cron already ran, nothing would create that day's task again until
 * tomorrow — this lets a person trigger it themselves instead of waiting.
 *
 * Respects autonomous_campaigns being off: if outreach is deliberately
 * turned off in Settings, this explains that rather than silently doing
 * nothing.
 */
export async function POST() {
  try {
    const settings = await getSettings();

    if (!settings.autonomous_campaigns) {
      return NextResponse.json(
        {
          error:
            "Autonomous outreach is turned off in Settings. Turn it on there first.",
        },
        { status: 400 }
      );
    }

    await ensureDailyEmailCampaignTask();
    await tick();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/followups/run-now] POST failed:", error);
    return NextResponse.json(
      { error: "Could not run outreach now." },
      { status: 500 }
    );
  }
}
