import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 5I — the Dashboard's "44 escalated" alert conflates two
 * genuinely different situations under one status: prospects flagged by
 * the earlier productless-prospects cleanup (a real but MECHANICAL
 * issue — just needs a product assigned) versus prospects the reply
 * system itself couldn't handle automatically (a genuine autonomy gap
 * worth investigating). This separates them, and for the genuine
 * escalations, surfaces WHY each one couldn't be replied to
 * automatically — pulled directly from inbound_emails.note, which is
 * where inboundProcessor.ts records its actual reasoning.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const total = await db.execute({
    sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'needs_human_reply'`,
    args: [LOCAL_USER_ID],
  });

  // Prospects with no product at all — these are the cleanup's doing,
  // not a reply-autonomy problem.
  const productless = await db.execute({
    sql: `
      SELECT COUNT(*) as c
      FROM prospects
      LEFT JOIN products ON products.id = prospects.product_id
      WHERE prospects.user_id = ?
        AND prospects.sequence_status = 'needs_human_reply'
        AND (prospects.product_id IS NULL OR products.id IS NULL)
    `,
    args: [LOCAL_USER_ID],
  });

  // The genuine reply-escalation cases, with the actual recorded reason
  // for each — this is the real signal for whether autonomy is working.
  const genuineEscalations = await db.execute({
    sql: `
      SELECT
        prospects.id,
        prospects.name,
        prospects.unsubscribe_token IS NULL AS missing_unsubscribe_token,
        (
          SELECT note FROM inbound_emails
          WHERE inbound_emails.prospect_id = prospects.id AND handled = 'escalated'
          ORDER BY received_at DESC LIMIT 1
        ) AS last_escalation_reason
      FROM prospects
      LEFT JOIN products ON products.id = prospects.product_id
      WHERE prospects.user_id = ?
        AND prospects.sequence_status = 'needs_human_reply'
        AND prospects.product_id IS NOT NULL
        AND products.id IS NOT NULL
      ORDER BY prospects.updated_at DESC
      LIMIT 50
    `,
    args: [LOCAL_USER_ID],
  });

  const rows = genuineEscalations.rows as unknown as Array<{
    id: string;
    name: string;
    missing_unsubscribe_token: boolean;
    last_escalation_reason: string | null;
  }>;

  const reasonCounts: Record<string, number> = {};
  for (const r of rows) {
    const key = r.last_escalation_reason ?? "(no inbound_emails record found)";
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

  return noCacheJson({
    totalNeedsHumanReply: (total.rows[0] as unknown as { c: number }).c,
    fromProductlessCleanup: (productless.rows[0] as unknown as { c: number }).c,
    genuineReplyEscalations: rows.length,
    escalationReasonBreakdown: reasonCounts,
    sampleEscalations: rows.slice(0, 10),
  });
}
