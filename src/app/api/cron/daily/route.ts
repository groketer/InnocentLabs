import { NextRequest, NextResponse } from "next/server";
import { ensureDailyPortfolioRefresh } from "@/lib/taskEngine/portfolioScheduler";
import { ensureDailyProspectingTask } from "@/lib/taskEngine/prospectingScheduler";
import { ensureDailyEmailCampaignTask } from "@/lib/taskEngine/emailCampaignScheduler";
import { ensureDailyAuditTask } from "@/lib/taskEngine/auditScheduler";
import { sendDailyDigestIfDue } from "@/lib/taskEngine/digestScheduler";
import { tick } from "@/lib/taskEngine/engine";
import { listActiveTopLevelTasks } from "@/lib/models/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron target — see vercel.json ("crons").
 *
 * On Hobby, Vercel Cron jobs can only run once a day, so this route does
 * everything the daily cadence needs to cover:
 *
 * 1. ensureDailyPortfolioRefresh() — creates today's portfolio_refresh
 *    task if it doesn't already exist (idempotent; locally this same
 *    function is called by the 15-minute interval in
 *    portfolioScheduler.ts instead — see that file for why the two
 *    trigger mechanisms differ by environment).
 * 2. ensureDailyProspectingTask() — creates one autonomous prospecting task
 *    per day with no product specified, letting the executor pick one on
 *    its own. This is what makes prospecting proactive instead of only
 *    ever running when a person manually starts it.
 * 3. Repeatedly tick() until nothing's left to do or the time budget runs
 *    out — NOT just once. A single tick() only advances the task queue by
 *    one step (e.g. "claim this task and plan its subtasks"), so calling
 *    it once would create today's tasks and then stop with almost nothing
 *    actually done. On a day nobody opens the app at all, this loop is
 *    the ONLY thing that will ever make real progress — the client-side
 *    EngineTicker (src/components/EngineTicker.tsx) only ticks while a
 *    browser tab is open and visible.
 *
 * Auth: Vercel signs cron requests with a bearer token matching the
 * CRON_SECRET environment variable when one is set — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * If CRON_SECRET isn't set (e.g. local dev), the check is skipped so this
 * route can still be hit manually while testing.
 */
const TICK_LOOP_BUDGET_MS = 45_000;
const TICK_LOOP_DELAY_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret) {
    const authHeader = req.headers.get("authorization");

    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  try {
    await ensureDailyPortfolioRefresh();
    await ensureDailyAuditTask();
    await ensureDailyProspectingTask();
    await ensureDailyEmailCampaignTask();
    await sendDailyDigestIfDue();

    const deadline = Date.now() + TICK_LOOP_BUDGET_MS;
    let ticks = 0;

    while (Date.now() < deadline) {
      await tick();
      ticks++;

      const stillActive = await listActiveTopLevelTasks();
      if (stillActive.length === 0) break;

      // See the matching comment in /api/followups/run-now — without a
      // delay this becomes a tight loop hammering the database thousands
      // of times in one request.
      await sleep(TICK_LOOP_DELAY_MS);
    }

    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      ticks,
    });
  } catch (error) {
    console.error("[api/cron/daily] failed:", error);
    return NextResponse.json({ error: "Daily cron run failed." }, { status: 500 });
  }
}

/**
 * Same maxDuration reasoning as /api/tasks/tick — verify against your
 * current Vercel plan's actual limit before deploying.
 */
export const maxDuration = 60;
