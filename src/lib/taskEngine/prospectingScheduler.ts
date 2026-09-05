/**
 * Autonomous Prospecting Scheduler
 * ---------------------------------
 *
 * MILESTONE 3E — AUTONOMOUS OPERATION.
 *
 * Mirrors portfolioScheduler.ts exactly, for the same reasons (see that
 * file's doc comment for the full local-vs-Vercel trigger explanation).
 *
 * This is what makes prospecting actually proactive rather than something
 * that only ever happens when a person creates a task by hand: it creates
 * one autonomous "web_prospecting" task per day, with no product specified
 * — the executor's own autoSelectProductForProspecting() (see
 * executors/prospecting.ts) decides which portfolio product to prospect
 * for, rotating toward whichever has the fewest prospects so far. Over
 * time this naturally works through the whole portfolio without a person
 * ever needing to pick a product or start a task themselves.
 *
 * IMPORTANT:
 *
 * Like portfolioScheduler.ts, this assumes a single-user system and reads
 * the user ID from the most recently created top-level task. Once there's
 * a real users/authentication layer, replace this with that authoritative
 * identity instead.
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { getSettings } from "@/lib/models/settings";

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

const PROSPECTING_TASK_TYPE = "web_prospecting";

const PROSPECTING_TITLE = "Autonomous prospecting run";

declare global {
  // eslint-disable-next-line no-var
  var __innocentProspectingSchedulerStarted: boolean | undefined;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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

  const row = result.rows[0] as unknown as { user_id: string } | undefined;

  return row?.user_id ?? null;
}

async function hasProspectingTaskToday(userId: string): Promise<boolean> {
  const db = await getDb();
  const datePrefix = `${todayKey()}%`;

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
    args: [userId, PROSPECTING_TASK_TYPE, PROSPECTING_TITLE, datePrefix],
  });

  const row = result.rows[0] as unknown as { id: string } | undefined;

  return !!row;
}

async function createDailyProspectingTask(userId: string): Promise<void> {
  if (await hasProspectingTaskToday(userId)) {
    return;
  }

  const task = await createTask({
    user_id: userId,
    parent_task_id: null,
    title: PROSPECTING_TITLE,
    description:
      "Autonomously identify evidence-backed, contactable prospects for a portfolio product. No specific product was requested — the executor picks one on its own (favoring whichever product currently has the fewest prospects), performs live web research across several rounds, and persists only prospects with a legitimate public email.",
    task_type: PROSPECTING_TASK_TYPE,
    status: "QUEUED",
    created_by: "system",
    max_retries: 3,
  });

  await logActivity({
    user_id: userId,
    task_id: task.id,
    event_type: "TASK_CREATED",
    message: `${PROSPECTING_TITLE}: created automatically.`,
  });
}

/**
 * Ensures today's autonomous prospecting task exists. Idempotent within a
 * given day — safe to call repeatedly, whether from the local interval
 * loop or the Vercel daily cron route.
 */
export async function ensureDailyProspectingTask(): Promise<void> {
  const settings = await getSettings();

  if (!settings.autonomous_prospecting) {
    return;
  }

  const userId = await getCurrentUserId();

  if (!userId) {
    return;
  }

  try {
    await createDailyProspectingTask(userId);
  } catch (error) {
    console.error(
      "[prospectingScheduler] Could not create daily prospecting task:",
      error
    );
  }
}

/**
 * Starts the local always-on scheduler. On Vercel this deliberately does
 * nothing — see portfolioScheduler.ts's matching function for why; the
 * daily check instead happens via the /api/cron/daily route.
 */
export function startProspectingScheduler(): void {
  if (global.__innocentProspectingSchedulerStarted) {
    return;
  }

  global.__innocentProspectingSchedulerStarted = true;

  if (process.env.VERCEL) {
    console.log(
      "[prospectingScheduler] Running on Vercel — skipping the local interval. " +
        "Daily autonomous prospecting is instead handled by the /api/cron/daily route."
    );
    return;
  }

  setTimeout(() => {
    ensureDailyProspectingTask().catch((err) =>
      console.error("[prospectingScheduler] initial check failed:", err)
    );
  }, 15_000);

  setInterval(() => {
    ensureDailyProspectingTask().catch((err) =>
      console.error("[prospectingScheduler] periodic check failed:", err)
    );
  }, SCHEDULER_INTERVAL_MS);

  console.log(
    "[prospectingScheduler] Started. Daily autonomous prospecting checks enabled."
  );
}
