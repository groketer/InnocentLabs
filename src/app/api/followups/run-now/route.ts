import { NextResponse } from "next/server";
import { ensureDailyEmailCampaignTask } from "@/lib/taskEngine/emailCampaignScheduler";
import { tick } from "@/lib/taskEngine/engine";
import { listActiveTopLevelTasks } from "@/lib/models/tasks";
import { getSettings } from "@/lib/models/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
 *
 * IMPORTANT: a single tick() only advances the WHOLE task queue by one
 * step each — for a brand-new task that's "claim it and plan subtasks,"
 * and a separate tick is needed to actually claim and run each individual
 * subtask after that. Calling tick() only once here would create the
 * task and then immediately return with nothing actually sent yet,
 * leaving it to the client-side ticker (which only runs while a browser
 * tab is open and visible) to make further progress. To make "run now"
 * actually mean now, this loops tick() until there's no more active work
 * or the time budget runs out, comfortably inside this route's
 * maxDuration.
 */
const TICK_LOOP_BUDGET_MS = 45_000;
const TICK_LOOP_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    const deadline = Date.now() + TICK_LOOP_BUDGET_MS;
    let ticks = 0;

    while (Date.now() < deadline) {
      await tick();
      ticks++;

      const stillActive = await listActiveTopLevelTasks();
      const campaignTasksActive = stillActive.some(
        (t) => t.task_type === "email_campaign"
      );

      if (!campaignTasksActive) break;

      // Without this, a call that returns quickly (nothing due yet, e.g.
      // waiting out a retry backoff) turns this into a tight loop that
      // hammers the database thousands of times in a few seconds — this
      // happened during testing (25,784 ticks in 45s) before this delay
      // was added.
      await sleep(TICK_LOOP_DELAY_MS);
    }

    return NextResponse.json({ ok: true, ticks });
  } catch (error) {
    console.error("[api/followups/run-now] POST failed:", error);
    return NextResponse.json(
      { error: "Could not run outreach now." },
      { status: 500 }
    );
  }
}
