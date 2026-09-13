import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 5Z — direct evidence for "7 tasks stuck over 2 hours" and
 * "124 failed in 24h", rather than guessing at whether the tick
 * fairness fix is insufficient, prospecting over-firing is the cause,
 * or something else entirely.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const stuckTasks = await db.execute({
    sql: `
      SELECT id, title, task_type, status, created_at, last_activity_at, updated_at
      FROM agent_tasks
      WHERE user_id = ?
        AND status IN ('RUNNING', 'QUEUED')
        AND parent_task_id IS NULL
        AND COALESCE(last_activity_at, updated_at) < ?
      ORDER BY created_at ASC
    `,
    args: [LOCAL_USER_ID, twoHoursAgo],
  });

  const stuckWithSubtasks = await Promise.all(
    (stuckTasks.rows as unknown as Array<{ id: string; title: string; task_type: string; status: string; created_at: string; last_activity_at: string | null; updated_at: string }>).map(
      async (t) => {
        const subResult = await db.execute({
          sql: `SELECT status, COUNT(*) as c FROM agent_tasks WHERE parent_task_id = ? GROUP BY status`,
          args: [t.id],
        });
        const subtaskCounts: Record<string, number> = {};
        for (const row of subResult.rows as unknown as Array<{ status: string; c: number }>) {
          subtaskCounts[row.status] = Number(row.c);
        }
        return { ...t, subtaskCounts };
      }
    )
  );

  const activeTaskCount = await db.execute({
    sql: `SELECT COUNT(*) as c FROM agent_tasks WHERE user_id = ? AND status IN ('RUNNING','QUEUED') AND parent_task_id IS NULL`,
    args: [LOCAL_USER_ID],
  });

  const failedByType = await db.execute({
    sql: `
      SELECT task_type, COUNT(*) as c
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND updated_at > ?
      GROUP BY task_type
      ORDER BY c DESC
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  return noCacheJson({
    currentlyActiveTopLevelTaskCount: (activeTaskCount.rows[0] as unknown as { c: number }).c,
    stuckCount: stuckWithSubtasks.length,
    stuckTasks: stuckWithSubtasks,
    failedLast24hByType: failedByType.rows,
  });
}
