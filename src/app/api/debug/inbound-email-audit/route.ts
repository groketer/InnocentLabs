import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6L — the decisive next check after bounce-handling-audit
 * showed zero recorded bounces despite "Undeliverable" items visible
 * in Resend's own Receiving dashboard. This checks whether the webhook
 * is recording ANYTHING at all, of any classification — if genuine
 * replies are also completely absent, the problem is webhook-wide
 * (delivery, signature verification, or a silent failure before the
 * database write), not specific to bounce detection.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const totalInbound = await db.execute({
    sql: `SELECT COUNT(*) as c FROM inbound_emails WHERE user_id = ?`,
    args: [LOCAL_USER_ID],
  });

  const byClassification = await db.execute({
    sql: `
      SELECT classification, COUNT(*) as c, MIN(received_at) as earliest, MAX(received_at) as latest
      FROM inbound_emails
      WHERE user_id = ?
      GROUP BY classification
      ORDER BY c DESC
    `,
    args: [LOCAL_USER_ID],
  });

  const mostRecent = await db.execute({
    sql: `
      SELECT id, from_address, subject, classification, handled, received_at
      FROM inbound_emails
      WHERE user_id = ?
      ORDER BY received_at DESC
      LIMIT 10
    `,
    args: [LOCAL_USER_ID],
  });

  const recentWebhookFailures = await db.execute({
    sql: `
      SELECT message, created_at
      FROM activity_events
      WHERE user_id = ? AND message LIKE '%webhook%'
      ORDER BY created_at DESC
      LIMIT 10
    `,
    args: [LOCAL_USER_ID],
  }).catch(() => ({ rows: [] }));

  return noCacheJson({
    totalInboundEmailsEverRecorded: Number((totalInbound.rows[0] as unknown as { c: number }).c),
    byClassification: byClassification.rows,
    mostRecent: mostRecent.rows,
    recentWebhookFailureLogs: recentWebhookFailures.rows,
  });
}
