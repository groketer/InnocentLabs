import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const db = await getDb();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const byMessage = await db.execute({
    sql: `
      SELECT COALESCE(error_message, '(none recorded)') as error_message, COUNT(*) as c
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND task_type = 'web_prospecting' AND updated_at > ?
      GROUP BY error_message
      ORDER BY c DESC
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  const byLevel = await db.execute({
    sql: `
      SELECT CASE WHEN parent_task_id IS NULL THEN 'top-level' ELSE 'subtask' END as level, COUNT(*) as c
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND task_type = 'web_prospecting' AND updated_at > ?
      GROUP BY level
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  const sample = await db.execute({
    sql: `
      SELECT id, title, error_message, created_at, updated_at, parent_task_id
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND task_type = 'web_prospecting' AND updated_at > ?
      ORDER BY updated_at DESC
      LIMIT 15
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  return noCacheJson({
    byMessage: byMessage.rows,
    byLevel: byLevel.rows,
    mostRecentSample: sample.rows,
  });
}
