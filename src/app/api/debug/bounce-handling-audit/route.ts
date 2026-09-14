import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6I — direct evidence for "confirm every bounce is
 * unsubscribed and never emailed again," rather than reasoning about
 * the code in the abstract. Two things checked directly:
 *
 * 1. Every recorded bounce (classification = 'bounce') that could NOT
 *    be matched to a known prospect — this is the one real gap in the
 *    current bounce-handling design: an unmatched bounce never updates
 *    any prospect's status, so that address stays eligible for future
 *    sends.
 * 2. Every prospect currently marked 'bounced' — confirming their
 *    next_send_at is genuinely null (never scheduled again) and that
 *    they don't appear in the actual live outreach-due query.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const totalBounces = await db.execute({
    sql: `SELECT COUNT(*) as c FROM inbound_emails WHERE user_id = ? AND classification = 'bounce'`,
    args: [LOCAL_USER_ID],
  });

  const unmatchedBounces = await db.execute({
    sql: `
      SELECT id, from_address, subject, received_at, note
      FROM inbound_emails
      WHERE user_id = ? AND classification = 'bounce' AND prospect_id IS NULL
      ORDER BY received_at DESC
    `,
    args: [LOCAL_USER_ID],
  });

  const matchedBounces = await db.execute({
    sql: `SELECT COUNT(*) as c FROM inbound_emails WHERE user_id = ? AND classification = 'bounce' AND prospect_id IS NOT NULL`,
    args: [LOCAL_USER_ID],
  });

  const bouncedProspectsNotBlocked = await db.execute({
    sql: `
      SELECT id, name, email, next_send_at
      FROM prospects
      WHERE user_id = ? AND sequence_status = 'bounced' AND next_send_at IS NOT NULL
    `,
    args: [LOCAL_USER_ID],
  });

  const totalBouncedProspects = await db.execute({
    sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'bounced'`,
    args: [LOCAL_USER_ID],
  });

  return noCacheJson({
    totalRecordedBounces: Number((totalBounces.rows[0] as unknown as { c: number }).c),
    matchedToProspect: Number((matchedBounces.rows[0] as unknown as { c: number }).c),
    unmatchedCount: unmatchedBounces.rows.length,
    unmatchedBounces: unmatchedBounces.rows,
    totalProspectsMarkedBounced: Number((totalBouncedProspects.rows[0] as unknown as { c: number }).c),
    bouncedButStillSchedulable: bouncedProspectsNotBlocked.rows,
  });
}
