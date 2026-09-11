import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * MILESTONE 4W — tests a specific theory: that different requests,
 * moments apart, are landing on different warm serverless instances
 * still holding different DATABASE_URL values in their process
 * environment (plausible given DATABASE_URL was recently edited) —
 * a genuinely different mechanism from build caching, which has
 * already been ruled out (this Vercel project always builds without
 * cache).
 *
 * Reveals, safely: which database this specific invocation is
 * actually talking to (host + database name, not the full connection
 * string), how many rows exist for last_tick_at (should always be
 * exactly one if the schema is healthy), and the process's own PID
 * and uptime, which reveals whether this hit a fresh or a long-warm
 * instance.
 */
export async function GET() {
  const dbUrlEnv =
    process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;

  let hostPreview = "(not set)";
  let dbNamePreview = "(not set)";
  if (dbUrlEnv) {
    try {
      const parsed = new URL(dbUrlEnv);
      hostPreview = parsed.hostname;
      dbNamePreview = parsed.pathname.replace(/^\//, "");
    } catch {
      hostPreview = "(could not parse)";
    }
  }

  const db = await getDb();

  const dbIdentity = await db.execute(`SELECT current_database() as db_name`);
  const rowCountForKey = await db.execute({
    sql: `SELECT COUNT(*) as c, array_agg(value) as all_values FROM app_meta WHERE key = ?`,
    args: ["last_tick_at"],
  });

  return NextResponse.json(
    {
      serverTimestamp: new Date().toISOString(),
      processPid: process.pid,
      processUptimeSeconds: process.uptime(),
      envDatabaseHostPreview: hostPreview,
      envDatabaseNamePreview: dbNamePreview,
      actualConnectedDatabaseName: (dbIdentity.rows[0] as unknown as { db_name: string })?.db_name,
      rowsForLastTickKey: rowCountForKey.rows[0],
    },
    { headers: NO_CACHE_HEADERS }
  );
}
