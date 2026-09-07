/**
 * MILESTONE 3S — genuine deep qualification, scheduled.
 *
 * Same pattern as auditScheduler.ts / prospectingScheduler.ts /
 * emailCampaignScheduler.ts: creates one "deep_qualification" task per
 * day when autonomous_qualification is on and there's actually a
 * needs_review prospect waiting. Batches up to 15 prospects per task
 * (see BATCH_SIZE in deepQualification.ts) to keep real OpenAI cost per
 * day bounded and predictable, the same reasoning as every other
 * autonomous job in this system.
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { listProspects } from "@/lib/models/prospects";
import { getSettings } from "@/lib/models/settings";

const TASK_TYPE = "deep_qualification";
const TITLE_PREFIX = "Deep qualification review:";

declare global {
  // eslint-disable-next-line no-var
  var __innocentDeepQualificationSchedulerStarted: boolean | undefined;
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
        AND parent_task_id IS NULL
        AND created_at LIKE ?
      LIMIT 1
    `,
    args: [userId, TASK_TYPE, datePrefix],
  });

  const row = result.rows[0] as unknown as { id: string } | undefined;
  return !!row;
}

async function createDailyDeepQualificationTask(userId: string): Promise<void> {
  if (await hasTaskToday(userId)) {
    return;
  }

  const waiting = await listProspects(userId, {
    qualification_status: "needs_review",
    limit: 1,
  });

  if (waiting.length === 0) {
    return;
  }

  const title = `${TITLE_PREFIX} ${todayKey()}`;

  const task = await createTask({
    user_id: userId,
    parent_task_id: null,
    title,
    description:
      "Created automatically — reviews needs_review prospects with fresh, targeted research before deciding qualified or unqualified, rather than relying on the confidence score assigned at initial discovery.",
    task_type: TASK_TYPE,
    status: "QUEUED",
    created_by: "system",
    max_retries: 3,
  });

  await logActivity({
    user_id: userId,
    task_id: task.id,
    event_type: "TASK_CREATED",
    message: `${title}: created automatically.`,
  });
}

export async function ensureDailyDeepQualificationTask(): Promise<void> {
  const settings = await getSettings();

  if (!settings.autonomous_qualification) {
    return;
  }

  const userId = await getCurrentUserId();
  if (!userId) return;

  try {
    await createDailyDeepQualificationTask(userId);
  } catch (error) {
    console.error(
      "[deepQualificationScheduler] Could not create daily task:",
      error
    );
  }
}

export function startDeepQualificationScheduler(): void {
  if (global.__innocentDeepQualificationSchedulerStarted) {
    return;
  }

  global.__innocentDeepQualificationSchedulerStarted = true;

  if (process.env.VERCEL) {
    console.log(
      "[deepQualificationScheduler] Running on Vercel — skipping the local interval. " +
        "Daily checks are instead handled by the /api/cron/daily route."
    );
    return;
  }

  setTimeout(() => {
    ensureDailyDeepQualificationTask().catch((err) =>
      console.error("[deepQualificationScheduler] initial check failed:", err)
    );
  }, 25_000);

  setInterval(() => {
    ensureDailyDeepQualificationTask().catch((err) =>
      console.error("[deepQualificationScheduler] periodic check failed:", err)
    );
  }, 15 * 60 * 1000);

  console.log("[deepQualificationScheduler] Started. Daily checks enabled.");
}
