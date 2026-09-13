import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfDayIso = startOfDay.toISOString();

  const bySource = await db.execute({
    sql: `
      SELECT source, model, COUNT(*) as calls, SUM(estimated_cost_usd) as cost, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
      FROM api_usage
      WHERE user_id = ? AND created_at > ?
      GROUP BY source, model
      ORDER BY calls DESC
    `,
    args: [LOCAL_USER_ID, startOfDayIso],
  });

  // Calls per hour, to spot whether this is a sustained pattern or a
  // short, dense burst (which would point at a loop/retry bug rather
  // than genuinely distributed workload).
  const byHour = await db.execute({
    sql: `
      SELECT to_char(created_at::timestamptz, 'YYYY-MM-DD HH24:00') as hour, COUNT(*) as calls
      FROM api_usage
      WHERE user_id = ? AND created_at > ?
      GROUP BY hour
      ORDER BY hour ASC
    `,
    args: [LOCAL_USER_ID, startOfDayIso],
  });

  return noCacheJson({
    totalCallsToday: bySource.rows.reduce((sum: number, r: unknown) => sum + Number((r as { calls: number }).calls), 0),
    bySource: bySource.rows,
    byHour: byHour.rows,
  });
}
