import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { listActiveSequences } from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4N — settles two questions at once that separate
 * diagnostics couldn't:
 *
 * 1. IS THIS RESPONSE EVEN FRESH? serverTimestamp changes every real
 *    execution. If two calls return an identical timestamp, the response
 *    is cached somewhere (CDN/edge — which incognito does NOT bypass),
 *    and no amount of browser-side refreshing will show current data.
 *
 * 2. IS IT THE QUERY OR THE PLUMBING? Runs the real listActiveSequences()
 *    AND a raw direct query using the identical WHERE clause for this one
 *    id, in the same request against the same connection. If raw finds it
 *    but listActiveSequences doesn't, the problem is inside that function.
 *    If neither finds it, the WHERE clause genuinely excludes it — despite
 *    byte-check saying it shouldn't, which would point at LOCAL_USER_ID
 *    resolving to something unexpected at runtime.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return noCacheJson({ error: "?id=... is required." }, { status: 400 });
  }

  const db = await getDb();

  const rawDirect = await db.execute({
    sql: `
      SELECT id, name, user_id, sequence_status
      FROM prospects
      WHERE user_id = @user_id
        AND sequence_status IN ('pending_approval','active','completed','responded','unsubscribed','paused','in_conversation','needs_human_reply','bounced')
        AND id = @id
    `,
    args: { user_id: LOCAL_USER_ID, id },
  });

  const rawNoUserFilter = await db.execute({
    sql: `SELECT id, name, user_id, sequence_status FROM prospects WHERE id = @id`,
    args: { id },
  });

  const sequences = await listActiveSequences(LOCAL_USER_ID);
  const foundViaFunction = sequences.find((s) => s.id === id);

  const inConversationCount = await db.execute({
    sql: `SELECT COUNT(*)::int AS count FROM prospects WHERE user_id = @user_id AND sequence_status = 'in_conversation'`,
    args: { user_id: LOCAL_USER_ID },
  });

  return noCacheJson({
    serverTimestamp: new Date().toISOString(),
    localUserIdAtRuntime: LOCAL_USER_ID,
    localUserIdLength: LOCAL_USER_ID.length,

    rawDirectQueryFoundIt: rawDirect.rows.length > 0,
    rawDirectRow: rawDirect.rows[0] ?? null,

    rowExistsAtAllIgnoringFilters: rawNoUserFilter.rows.length > 0,
    rowIgnoringFilters: rawNoUserFilter.rows[0] ?? null,

    listActiveSequencesFoundIt: !!foundViaFunction,
    listActiveSequencesTotal: sequences.length,

    totalInConversationForThisUser: inConversationCount.rows[0] ?? null,
  });
}
