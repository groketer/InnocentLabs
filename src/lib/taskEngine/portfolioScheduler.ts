/**
 * Innocent Labs Portfolio Scheduler
 * ----------------------------------
 *
 * Milestone 3D - Daily portfolio awareness.
 *
 * Creates at most one portfolio_refresh task per day.
 *
 * The scheduler does NOT perform the website visit itself.
 * It only creates a normal task for the existing task engine.
 *
 * The task engine then executes portfolio_refresh through its normal
 * lifecycle, claim, heartbeat, retry, persistence and activity mechanisms.
 *
 * IMPORTANT:
 *
 * This scheduler assumes the current application is a single-user system.
 * It obtains the user ID from the most recently created top-level task.
 *
 * Once Innocent Intelligence has a formal users table/authentication layer,
 * this should be changed to use that authoritative user identity instead.
 *
 * MILESTONE 3E — VERCEL:
 *
 * `ensureDailyPortfolioRefresh()` is exported and is the same function
 * whether it's called by the old setInterval loop (local dev) or by the
 * `/api/cron/daily` route on a Vercel Cron schedule — it's idempotent per
 * day either way, via hasRefreshTaskToday().
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";

const SCHEDULER_INTERVAL_MS =
  15 * 60 * 1000;

/**
 * Locally, we check every 15 minutes whether today's refresh task exists.
 * On Vercel this check instead happens once per invocation of the daily
 * cron route (see /api/cron/daily).
 *
 * The actual portfolio refresh itself remains a normal task and therefore
 * remains subject to the task engine's execution and retry behavior.
 */
const REFRESH_TASK_TYPE =
  "portfolio_refresh";

const REFRESH_TITLE =
  "Refresh Innocent Labs Portfolio";

declare global {
  // eslint-disable-next-line no-var
  var __innocentPortfolioSchedulerStarted:
    | boolean
    | undefined;
}

function todayKey(): string {
  const now = new Date();

  return now
    .toISOString()
    .slice(0, 10);
}

async function getCurrentUserId(): Promise<string | null> {
  const db = await getDb();

  const result = await db.execute(`
    SELECT user_id
    FROM agent_tasks
    WHERE parent_task_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const row = result.rows[0] as unknown as
    | { user_id: string }
    | undefined;

  return row?.user_id ?? null;
}

async function hasRefreshTaskToday(
  userId: string
): Promise<boolean> {
  const db = await getDb();

  const datePrefix =
    `${todayKey()}%`;

  const result = await db.execute({
    sql: `
      SELECT id
      FROM agent_tasks
      WHERE user_id = ?
        AND task_type = ?
        AND title = ?
        AND parent_task_id IS NULL
        AND created_at LIKE ?
      LIMIT 1
    `,
    args: [userId, REFRESH_TASK_TYPE, REFRESH_TITLE, datePrefix],
  });

  const row = result.rows[0] as unknown as
    | { id: string }
    | undefined;

  return !!row;
}

async function createDailyRefreshTask(
  userId: string
): Promise<void> {
  if (
    await hasRefreshTaskToday(userId)
  ) {
    return;
  }

  const task = await createTask({
    user_id: userId,

    parent_task_id: null,

    title: REFRESH_TITLE,

    description:
      `Visit ${"https://innocent.co.ke"} and reconcile the publicly observable Innocent Labs portfolio. Identify product-like public entries, validate their URLs, and persist newly discovered portfolio products without overwriting deeper product intelligence.`,

    task_type:
      REFRESH_TASK_TYPE,

    status: "QUEUED",

    created_by: "system",

    max_retries: 3,
  });

  await logActivity({
    user_id: userId,

    task_id: task.id,

    event_type:
      "TASK_CREATED",

    message:
      `${REFRESH_TITLE}: daily portfolio refresh task created automatically.`,
  });
}

/**
 * Ensures today's portfolio refresh task exists. Safe to call repeatedly —
 * hasRefreshTaskToday() makes this idempotent within a given day, whether
 * it's invoked by the local interval loop or the Vercel daily cron route.
 */
export async function ensureDailyPortfolioRefresh(): Promise<void> {
  const userId =
    await getCurrentUserId();

  if (!userId) {
    return;
  }

  try {
    await createDailyRefreshTask(
      userId
    );
  } catch (error) {
    console.error(
      "[portfolioScheduler] Could not create daily portfolio refresh task:",
      error
    );
  }
}

/**
 * Starts the local always-on scheduler.
 *
 * On Vercel there is no long-lived process for setInterval/setTimeout to
 * live in, so this deliberately does nothing there — the daily check
 * instead happens via the `/api/cron/daily` Vercel Cron route, which calls
 * ensureDailyPortfolioRefresh() directly.
 */
export function startPortfolioScheduler(): void {
  if (
    global.__innocentPortfolioSchedulerStarted
  ) {
    return;
  }

  global.__innocentPortfolioSchedulerStarted =
    true;

  if (process.env.VERCEL) {
    console.log(
      "[portfolioScheduler] Running on Vercel — skipping the local interval. " +
        "Daily refresh is instead handled by the /api/cron/daily route."
    );
    return;
  }

  /**
   * Perform the first check shortly after application startup.
   *
   * A short delay avoids competing with initial database/bootstrap work.
   */
  setTimeout(() => {
    ensureDailyPortfolioRefresh().catch((err) =>
      console.error("[portfolioScheduler] initial check failed:", err)
    );
  }, 10_000);

  setInterval(() => {
    ensureDailyPortfolioRefresh().catch((err) =>
      console.error("[portfolioScheduler] periodic check failed:", err)
    );
  }, SCHEDULER_INTERVAL_MS);

  console.log(
    "[portfolioScheduler] Started. Daily portfolio refresh checks enabled."
  );
}
