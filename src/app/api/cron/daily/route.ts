import { NextRequest, NextResponse } from "next/server";
import { ensureDailyPortfolioRefresh } from "@/lib/taskEngine/portfolioScheduler";
import { tick } from "@/lib/taskEngine/engine";

export const runtime = "nodejs";

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
 * 2. tick() — one safety tick, so that task (and any other still-active
 *    task) gets a chance to make progress even if nobody has the app
 *    open in a browser tab that day. On Hobby this is the ONLY
 *    guaranteed engine progress on days nobody visits the app; the rest
 *    of the time, progress comes from the client-side EngineTicker
 *    (src/components/EngineTicker.tsx) polling /api/tasks/tick while the
 *    app is open.
 *
 * Auth: Vercel signs cron requests with a bearer token matching the
 * CRON_SECRET environment variable when one is set — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs.
 * If CRON_SECRET isn't set (e.g. local dev), the check is skipped so this
 * route can still be hit manually while testing.
 */
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
    await tick();

    return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
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
