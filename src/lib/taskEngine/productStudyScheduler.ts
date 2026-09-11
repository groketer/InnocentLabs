/**
 * Product Study Scheduler
 * ------------------------
 *
 * MILESTONE 4T — full autonomy mode.
 *
 * Same pattern as the other daily schedulers — creates one
 * "product_study" task per day when autonomous_product_study is on.
 * The executor picks which product to review on its own (rotating
 * toward whichever was studied longest ago), so over time the whole
 * portfolio gets periodically reviewed without anyone needing to
 * trigger it by hand.
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { getSettings } from "@/lib/models/settings";

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

const TASK_TYPE = "product_study";

const TITLE = "Autonomous product knowledge review";

declare global {
  // eslint-disable-next-line no-var
  var __innocentProductStudySchedulerStarted: boolean | undefined;
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

async function hasTaskToday(userId: string): Promise<boolean> {
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
    args: [userId, TASK_TYPE, TITLE, datePrefix],
  });

  return !!(result.rows[0] as unknown as { id: string } | undefined);
}

async function createDailyTask(userId: string): Promise<void> {
  if (await hasTaskToday(userId)) return;

  const task = await createTask({
    user_id: userId,
    parent_task_id: null,
    title: TITLE,
    description:
      "Reviews one product's stored knowledge, raising genuine questions or improvement suggestions rather than working with gaps indefinitely.",
    task_type: TASK_TYPE,
    status: "QUEUED",
    created_by: "system",
    max_retries: 3,
  });

  await logActivity({
    user_id: userId,
    task_id: task.id,
    event_type: "TASK_CREATED",
    message: `${TITLE}: created automatically.`,
  });
}

export async function ensureDailyProductStudyTask(): Promise<void> {
  const settings = await getSettings();
  if (!settings.autonomous_product_study) return;

  const userId = await getCurrentUserId();
  if (!userId) return;

  try {
    await createDailyTask(userId);
  } catch (error) {
    console.error("[productStudyScheduler] Could not create daily task:", error);
  }
}

export function startProductStudyScheduler(): void {
  if (global.__innocentProductStudySchedulerStarted) return;
  global.__innocentProductStudySchedulerStarted = true;

  if (process.env.VERCEL) {
    console.log(
      "[productStudyScheduler] Running on Vercel — skipping the local interval. " +
        "Daily checks are instead handled by tick()."
    );
    return;
  }

  setTimeout(() => {
    ensureDailyProductStudyTask().catch((err) =>
      console.error("[productStudyScheduler] initial check failed:", err)
    );
  }, 30_000);

  setInterval(() => {
    ensureDailyProductStudyTask().catch((err) =>
      console.error("[productStudyScheduler] periodic check failed:", err)
    );
  }, SCHEDULER_INTERVAL_MS);

  console.log("[productStudyScheduler] Started. Daily checks enabled.");
}
