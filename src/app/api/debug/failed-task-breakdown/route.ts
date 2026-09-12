import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 5R — the failed-task count has moved 121 → 70 → 68 → 106 →
 * 99 across this whole investigation without ever being looked at
 * directly — every fix so far addressed a specific, separately-diagnosed
 * bug (stuck tasks, missing product_id, tick starvation), and each
 * likely explained SOME of the count, but nobody has actually looked at
 * what these 99 currently failing tasks say about why they failed. This
 * groups by task_type and the actual error_message, which is the only
 * way to tell whether this is a few dominant, fixable causes or a long
 * tail of unrelated one-offs.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const byTaskType = await db.execute({
    sql: `
      SELECT task_type, COUNT(*) as c
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND updated_at > ?
      GROUP BY task_type
      ORDER BY c DESC
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  const byErrorMessage = await db.execute({
    sql: `
      SELECT
        task_type,
        COALESCE(error_message, '(no error_message recorded)') as error_message,
        COUNT(*) as c
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND updated_at > ?
      GROUP BY task_type, error_message
      ORDER BY c DESC
      LIMIT 30
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  // Whether these are mostly top-level tasks or subtasks — a top-level
  // task failing is a bigger deal (the whole run failed) than a single
  // subtask failing within an otherwise fine run.
  const byLevel = await db.execute({
    sql: `
      SELECT
        CASE WHEN parent_task_id IS NULL THEN 'top-level' ELSE 'subtask' END as level,
        COUNT(*) as c
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND updated_at > ?
      GROUP BY level
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  const sample = await db.execute({
    sql: `
      SELECT id, title, task_type, error_message, created_at, updated_at, parent_task_id
      FROM agent_tasks
      WHERE user_id = ? AND status = 'FAILED' AND updated_at > ?
      ORDER BY updated_at DESC
      LIMIT 15
    `,
    args: [LOCAL_USER_ID, oneDayAgo],
  });

  return noCacheJson({
    byTaskType: byTaskType.rows,
    byLevel: byLevel.rows,
    byErrorMessage: byErrorMessage.rows,
    mostRecentSample: sample.rows,
  });
}
