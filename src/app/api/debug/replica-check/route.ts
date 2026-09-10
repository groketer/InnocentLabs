import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4P — tests the read-replica-lag theory.
 *
 * Evidence so far: in a SINGLE request, a raw query finds a row that a
 * second query with an identical WHERE clause does not, and the whole
 * Follow-ups page shows data roughly a day stale while other queries
 * return current data. That combination is impossible against one
 * consistent database — but it's exactly what happens when reads are
 * spread across replicas where one is lagging behind.
 *
 * This runs the same count several times in one request. Identical
 * results every time = one consistent database, theory disproved.
 * Results that VARY between runs = reads are landing on different
 * servers with different data, which would explain everything.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();
  const runs: unknown[] = [];

  for (let i = 1; i <= 6; i++) {
    const result = await db.execute({
      sql: `
        SELECT
          COUNT(*)::int AS matching_rows,
          COUNT(*) FILTER (WHERE sequence_status = 'in_conversation')::int AS in_conversation_rows,
          MAX(updated_at) AS newest_updated_at
        FROM prospects
        WHERE user_id = @user_id
          AND sequence_status IN ('pending_approval', 'active', 'completed', 'responded', 'unsubscribed', 'paused', 'in_conversation', 'needs_human_reply', 'bounced')
      `,
      args: { user_id: LOCAL_USER_ID },
    });

    runs.push({ run: i, ...(result.rows[0] as Record<string, unknown>) });
  }

  const distinct = new Set(
    runs.map((r) => JSON.stringify({ ...(r as Record<string, unknown>), run: undefined }))
  );

  return noCacheJson({
    serverTimestamp: new Date().toISOString(),
    runs,
    distinctResultShapes: distinct.size,
    verdict:
      distinct.size > 1
        ? "VARIES BETWEEN RUNS — reads are landing on different servers with different data (replica lag). That explains the stale Follow-ups page."
        : "Consistent across all runs — replica lag is disproved; the inconsistency is somewhere else.",
  });
}
