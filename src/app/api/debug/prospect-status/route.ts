import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4L — direct diagnostic for "why isn't this prospect showing
 * on Follow-ups" — shows the exact sequence_status and related fields
 * rather than guessing from what's visible in the UI (which doesn't
 * display sequence_status as text at all, only implicitly via which
 * buttons appear).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");

  if (!email) {
    return noCacheJson({ error: "?email=... is required." }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM prospects WHERE user_id = ? AND email = ?`,
    args: [LOCAL_USER_ID, email],
  });

  const rows = result.rows as unknown as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return noCacheJson({ error: "No prospect found with that email." }, { status: 404 });
  }

  const inboundResult = await db.execute({
    sql: `SELECT classification, handled, note, received_at FROM inbound_emails WHERE user_id = ? AND prospect_id = ? ORDER BY received_at DESC LIMIT 10`,
    args: [LOCAL_USER_ID, rows[0].id as string],
  });

  return noCacheJson({
    prospect: rows[0],
    recentInboundEmails: inboundResult.rows,
  });
}
