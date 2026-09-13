import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { updateTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6D — cleanup for the historical damage left by the
 * duplicate-planning bug (fixed separately). Only targets tasks that
 * are STILL ACTIVE (NEEDS_INPUT, PAUSED, RUNNING, QUEUED) with an
 * abnormally high subtask count — these could still resume and
 * generate more duplicate work or cost if left alone. Already-finished
 * tasks (COMPLETED, FAILED, CANCELLED) are real historical records and
 * are left completely untouched here, regardless of their subtask
 * count.
 */
async function findCleanupCandidates() {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT p.id, p.title, p.task_type, p.status, COUNT(s.id) as subtask_count
      FROM agent_tasks p
      JOIN agent_tasks s ON s.parent_task_id = p.id
      WHERE p.user_id = ?
        AND p.status IN ('NEEDS_INPUT', 'PAUSED', 'RUNNING', 'QUEUED')
      GROUP BY p.id, p.title, p.task_type, p.status
      HAVING COUNT(s.id) >= 20
      ORDER BY subtask_count DESC
    `,
    args: [LOCAL_USER_ID],
  });
  return result.rows as unknown as Array<{ id: string; title: string; task_type: string; status: string; subtask_count: number }>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("confirm") === "yes") {
    return applyCleanup();
  }

  const candidates = await findCleanupCandidates();
  return noCacheJson({
    dryRun: true,
    candidateCount: candidates.length,
    tasks: candidates,
    note: "This is a preview only — nothing changed. Add &confirm=yes to cancel these tasks and their still-queued subtasks. Already-finished tasks are never touched by this, regardless of their subtask count.",
  });
}

export async function POST(_req: NextRequest) {
  return applyCleanup();
}

async function applyCleanup() {
  const db = await getDb();
  const candidates = await findCleanupCandidates();
  const cleaned: string[] = [];

  for (const task of candidates) {
    await db.execute({
      sql: `UPDATE agent_tasks SET status = 'CANCELLED' WHERE parent_task_id = ? AND status IN ('QUEUED', 'RUNNING', 'RETRYING')`,
      args: [task.id],
    });
    await updateTask(task.id, { status: "CANCELLED", completed_at: new Date().toISOString() });
    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: task.id,
      event_type: "TASK_CANCELLED",
      message: `${task.title}: cancelled during cleanup — had ${task.subtask_count} subtasks, almost certainly duplicated by a since-fixed planning bug.`,
    });
    cleaned.push(`${task.title} (${task.subtask_count} subtasks)`);
  }

  return noCacheJson({ cleanedCount: cleaned.length, cleaned });
}
