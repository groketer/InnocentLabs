/**
 * Email Campaign Scheduler
 * -------------------------
 *
 * MILESTONE 3F — Follow-up campaigns.
 *
 * Same pattern as portfolioScheduler.ts / prospectingScheduler.ts: creates
 * one "email_campaign" top-level task per day. Its executor
 * (executors/emailCampaign.ts) figures out on its own who's actually due
 * for an email that day — if nobody is, the task just completes with
 * nothing to do, which is normal and not an error.
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

const CAMPAIGN_TASK_TYPE = "email_campaign";

const CAMPAIGN_TITLE = "Daily outreach run";

declare global {
  // eslint-disable-next-line no-var
  var __innocentEmailCampaignSchedulerStarted: boolean | undefined;
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

async function hasCampaignTaskToday(userId: string): Promise<boolean> {
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
    args: [userId, CAMPAIGN_TASK_TYPE, CAMPAIGN_TITLE, datePrefix],
  });

  const row = result.rows[0] as unknown as { id: string } | undefined;
  return !!row;
}

async function createDailyCampaignTask(userId: string): Promise<void> {
  if (await hasCampaignTaskToday(userId)) {
    return;
  }

  const task = await createTask({
    user_id: userId,
    parent_task_id: null,
    title: CAMPAIGN_TITLE,
    description:
      "Send the next due email (initial outreach or follow-up) to every qualified prospect whose sequence says it's time, up to the daily send limit in Settings.",
    task_type: CAMPAIGN_TASK_TYPE,
    status: "QUEUED",
    created_by: "system",
    max_retries: 3,
  });

  await logActivity({
    user_id: userId,
    task_id: task.id,
    event_type: "TASK_CREATED",
    message: `${CAMPAIGN_TITLE}: created automatically.`,
  });
}

export async function ensureDailyEmailCampaignTask(): Promise<void> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return;
  }

  try {
    await createDailyCampaignTask(userId);
  } catch (error) {
    console.error(
      "[emailCampaignScheduler] Could not create daily campaign task:",
      error
    );
  }
}

export function startEmailCampaignScheduler(): void {
  if (global.__innocentEmailCampaignSchedulerStarted) {
    return;
  }

  global.__innocentEmailCampaignSchedulerStarted = true;

  if (process.env.VERCEL) {
    console.log(
      "[emailCampaignScheduler] Running on Vercel — skipping the local interval. " +
        "Daily outreach runs are instead handled by the /api/cron/daily route."
    );
    return;
  }

  setTimeout(() => {
    ensureDailyEmailCampaignTask().catch((err) =>
      console.error("[emailCampaignScheduler] initial check failed:", err)
    );
  }, 20_000);

  setInterval(() => {
    ensureDailyEmailCampaignTask().catch((err) =>
      console.error("[emailCampaignScheduler] periodic check failed:", err)
    );
  }, SCHEDULER_INTERVAL_MS);

  console.log(
    "[emailCampaignScheduler] Started. Daily outreach run checks enabled."
  );
}
