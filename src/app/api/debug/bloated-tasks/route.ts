import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6C — before re-enabling the agent, checking how much
 * historical damage the duplicate-planning bug actually left behind.
 * No legitimate executor plans anywhere close to 20 subtasks
 * (prospecting plans 4; most others plan far fewer) — anything at or
 * above that is almost certainly a re-planning casualty, not genuine
 * work.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const bloated = await db.execute({
    sql: `
      SELECT
        p.id, p.title, p.task_type, p.status, p.created_at, p.completed_at,
        COUNT(s.id) as subtask_count
      FROM agent_tasks p
      JOIN agent_tasks s ON s.parent_task_id = p.id
      WHERE p.user_id = ?
      GROUP BY p.id, p.title, p.task_type, p.status, p.created_at, p.completed_at
      HAVING COUNT(s.id) >= 20
      ORDER BY subtask_count DESC
    `,
    args: [LOCAL_USER_ID],
  });

  const totalWastedSubtasks = (bloated.rows as unknown as Array<{ subtask_count: number }>).reduce(
    (sum, r) => sum + Number(r.subtask_count),
    0
  );

  return noCacheJson({
    bloatedTaskCount: bloated.rows.length,
    totalSubtasksAcrossThem: totalWastedSubtasks,
    tasks: bloated.rows,
  });
}
