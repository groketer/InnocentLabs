import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 8T — a direct, real check of a serious reported symptom:
 * two real inbound replies (a demo request, then "I'm interested, how
 * do I proceed") got zero response. Rather than theorize further about
 * the strict json_schema change being the cause, this checks the real
 * database state directly — was the inbound email even recorded, what
 * its handled status actually is, and whether any outbound reply
 * exists at all for this prospect.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email") ?? "admin@prfed.com";

  const db = await getDb();

  const prospectResult = await db.execute({
    sql: `SELECT id, name, email, product_id, sequence_status, updated_at FROM prospects WHERE user_id = ? AND email = ?`,
    args: [LOCAL_USER_ID, email],
  });

  const prospects = prospectResult.rows as unknown as Array<{
    id: string;
    name: string;
    email: string;
    product_id: string | null;
    sequence_status: string;
    updated_at: string;
  }>;

  const results = [];
  for (const prospect of prospects) {
    const [inboundResult, sendsResult] = await Promise.all([
      db.execute({
        sql: `SELECT id, subject, classification, handled, note, received_at FROM inbound_emails WHERE prospect_id = ? ORDER BY received_at ASC`,
        args: [prospect.id],
      }),
      db.execute({
        sql: `SELECT id, direction, step, status, subject, sent_at, created_at FROM email_sends WHERE prospect_id = ? ORDER BY COALESCE(sent_at, created_at) ASC`,
        args: [prospect.id],
      }),
    ]);

    results.push({
      prospectId: prospect.id,
      sequenceStatus: prospect.sequence_status,
      inboundEmails: inboundResult.rows,
      allEmailSends: sendsResult.rows,
    });
  }

  return noCacheJson({
    note: "inboundEmails shows whether each reply was even recorded and what 'handled' resolved to. allEmailSends shows every send/reply row, outbound and inbound, in order - if a reply was composed but not delivered, or never attempted at all, this shows exactly where.",
    email,
    prospectsFound: prospects.length,
    results,
  });
}
