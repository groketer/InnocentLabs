/**
 * Autonomous Audit Scheduler
 * ---------------------------
 *
 * MILESTONE 3I — autonomous auditing.
 *
 * Same pattern as portfolioScheduler.ts / prospectingScheduler.ts /
 * emailCampaignScheduler.ts: creates one "website_audit" task per day,
 * targeting whichever single product most needs a fresh audit (see
 * getProductMostNeedingAudit()'s doc comment in models/products.ts).
 *
 * WHY THIS EXISTS:
 * Before this, a product only got real intelligence (problem, audience,
 * positioning, features, pricing, CTA — everything beyond a bare name and
 * URL) if a person manually clicked "Audit now" on the Products page.
 * The prospecting agent was doing its best with whatever thin context it
 * had, which is a real ceiling on how confident and targeted its research
 * can be. This closes that gap on its own, gradually working through the
 * whole portfolio (and re-freshening it over time) with no prompting.
 */

import { getDb } from "@/lib/db";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { getProductMostNeedingAudit } from "@/lib/models/products";
import { getSettings } from "@/lib/models/settings";

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

const AUDIT_TASK_TYPE = "website_audit";

const AUDIT_TITLE_PREFIX = "Autonomous audit:";

declare global {
  // eslint-disable-next-line no-var
  var __innocentAuditSchedulerStarted: boolean | undefined;
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

async function hasAuditTaskToday(userId: string): Promise<boolean> {
  const db = await getDb();
  const datePrefix = `${todayKey()}%`;

  const result = await db.execute({
    sql: `
      SELECT id
      FROM agent_tasks
      WHERE user_id = ?
        AND task_type = ?
        AND title LIKE ?
        AND parent_task_id IS NULL
        AND created_at LIKE ?
      LIMIT 1
    `,
    args: [userId, AUDIT_TASK_TYPE, `${AUDIT_TITLE_PREFIX}%`, datePrefix],
  });

  const row = result.rows[0] as unknown as { id: string } | undefined;
  return !!row;
}

async function createDailyAuditTask(userId: string): Promise<void> {
  if (await hasAuditTaskToday(userId)) {
    return;
  }

  const product = await getProductMostNeedingAudit();

  if (!product) {
    return;
  }

  const title = `${AUDIT_TITLE_PREFIX} ${product.name}`;

  const task = await createTask({
    user_id: userId,
    parent_task_id: null,
    title,
    description: `Product: ${product.name}\n\nCreated automatically to keep product intelligence current for prospecting.`,
    task_type: AUDIT_TASK_TYPE,
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

export async function ensureDailyAuditTask(): Promise<void> {
  const settings = await getSettings();

  if (!settings.autonomous_prospecting) {
    // Deliberately reuses autonomous_prospecting rather than adding a
    // fourth autonomy toggle: auditing exists specifically to feed
    // prospecting, so it makes sense for them to share one switch.
    return;
  }

  const userId = await getCurrentUserId();

  if (!userId) {
    return;
  }

  try {
    await createDailyAuditTask(userId);
  } catch (error) {
    console.error(
      "[auditScheduler] Could not create daily audit task:",
      error
    );
  }
}

export function startAuditScheduler(): void {
  if (global.__innocentAuditSchedulerStarted) {
    return;
  }

  global.__innocentAuditSchedulerStarted = true;

  if (process.env.VERCEL) {
    console.log(
      "[auditScheduler] Running on Vercel — skipping the local interval. " +
        "Daily audits are instead handled by the /api/cron/daily route."
    );
    return;
  }

  setTimeout(() => {
    ensureDailyAuditTask().catch((err) =>
      console.error("[auditScheduler] initial check failed:", err)
    );
  }, 25_000);

  setInterval(() => {
    ensureDailyAuditTask().catch((err) =>
      console.error("[auditScheduler] periodic check failed:", err)
    );
  }, SCHEDULER_INTERVAL_MS);

  console.log("[auditScheduler] Started. Daily audit checks enabled.");
}
