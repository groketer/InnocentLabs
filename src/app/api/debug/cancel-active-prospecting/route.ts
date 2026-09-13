import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { updateTask, listSubtasks } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6A — immediate relief for a direct request: stopping every
 * currently-active prospecting run right now, rather than cancelling
 * each one individually through the UI one at a time.
 */
async function findActiveProspectingTasks() {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT id, title, created_at
      FROM agent_tasks
      WHERE user_id = ?
        AND task_type = 'web_prospecting'
        AND status IN ('QUEUED', 'RUNNING')
        AND parent_task_id IS NULL
    `,
    args: [LOCAL_USER_ID],
  });
  return result.rows as unknown as Array<{ id: string; title: string; created_at: string }>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("confirm") === "yes") {
    return applyCancel();
  }

  const active = await findActiveProspectingTasks();
  return noCacheJson({
    dryRun: true,
    activeCount: active.length,
    tasks: active,
    note: "This is a preview only — nothing changed. Add &confirm=yes to this same URL to cancel all of these now.",
  });
}

export async function POST(_req: NextRequest) {
  return applyCancel();
}

async function applyCancel() {
  const active = await findActiveProspectingTasks();
  const cancelled: string[] = [];

  for (const task of active) {
    const subtasks = await listSubtasks(task.id);
    for (const s of subtasks) {
      if (s.status === "QUEUED" || s.status === "RUNNING" || s.status === "RETRYING") {
        await updateTask(s.id, { status: "CANCELLED" });
      }
    }
    await updateTask(task.id, { status: "CANCELLED", completed_at: new Date().toISOString() });
    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: task.id,
      event_type: "TASK_CANCELLED",
      message: `${task.title}: cancelled manually via bulk stop.`,
    });
    cancelled.push(task.title);
  }

  return noCacheJson({ cancelledCount: cancelled.length, cancelled });
}
