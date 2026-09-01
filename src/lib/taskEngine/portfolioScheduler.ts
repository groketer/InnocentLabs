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
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";

const SCHEDULER_INTERVAL_MS =
  15 * 60 * 1000;

/**
 * We check every 15 minutes whether today's refresh task exists.
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

function getCurrentUserId(): string | null {
  const db = getDb();

  const row = db
    .prepare(`
      SELECT user_id
      FROM agent_tasks
      WHERE parent_task_id IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get() as
    | { user_id: string }
    | undefined;

  return row?.user_id ?? null;
}

function hasRefreshTaskToday(
  userId: string
): boolean {
  const db = getDb();

  const datePrefix =
    `${todayKey()}%`;

  const row = db
    .prepare(`
      SELECT id
      FROM agent_tasks
      WHERE user_id = ?
        AND task_type = ?
        AND title = ?
        AND parent_task_id IS NULL
        AND created_at LIKE ?
      LIMIT 1
    `)
    .get(
      userId,
      REFRESH_TASK_TYPE,
      REFRESH_TITLE,
      datePrefix
    ) as
    | { id: string }
    | undefined;

  return !!row;
}

function createDailyRefreshTask(
  userId: string
): void {
  if (
    hasRefreshTaskToday(userId)
  ) {
    return;
  }

  const task = createTask({
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

  logActivity({
    user_id: userId,

    task_id: task.id,

    event_type:
      "TASK_CREATED",

    message:
      `${REFRESH_TITLE}: daily portfolio refresh task created automatically.`,
  });
}

export function ensureDailyPortfolioRefresh(): void {
  const userId =
    getCurrentUserId();

  if (!userId) {
    return;
  }

  try {
    createDailyRefreshTask(
      userId
    );
  } catch (error) {
    console.error(
      "[portfolioScheduler] Could not create daily portfolio refresh task:",
      error
    );
  }
}

export function startPortfolioScheduler(): void {
  if (
    global.__innocentPortfolioSchedulerStarted
  ) {
    return;
  }

  global.__innocentPortfolioSchedulerStarted =
    true;

  /**
   * Perform the first check shortly after application startup.
   *
   * A short delay avoids competing with initial database/bootstrap work.
   */
  setTimeout(() => {
    ensureDailyPortfolioRefresh();
  }, 10_000);

  setInterval(() => {
    ensureDailyPortfolioRefresh();
  }, SCHEDULER_INTERVAL_MS);

  console.log(
    "[portfolioScheduler] Started. Daily portfolio refresh checks enabled."
  );
}