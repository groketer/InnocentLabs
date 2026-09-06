/**
 * MILESTONE 3J — Inbound email.
 *
 * One row per inbound message the IMAP checker has seen — the audit trail
 * for exactly what came in and how it was handled (replied to
 * autonomously, escalated, recognized as a bounce, or skipped as
 * unmatched/an auto-responder).
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export type InboundClassification = "reply" | "bounce" | "auto_reply" | "unmatched";
export type InboundHandled = "pending" | "replied" | "escalated" | "skipped";

export interface InboundEmail {
  id: string;
  user_id: string;
  prospect_id?: string;
  message_id?: string;
  from_address: string;
  subject?: string;
  body?: string;
  classification: InboundClassification;
  handled: InboundHandled;
  note?: string;
  received_at: string;
}

function mapRow(row: Record<string, unknown>): InboundEmail {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    prospect_id: row.prospect_id ? String(row.prospect_id) : undefined,
    message_id: row.message_id ? String(row.message_id) : undefined,
    from_address: String(row.from_address),
    subject: row.subject ? String(row.subject) : undefined,
    body: row.body ? String(row.body) : undefined,
    classification: row.classification as InboundClassification,
    handled: row.handled as InboundHandled,
    note: row.note ? String(row.note) : undefined,
    received_at: String(row.received_at),
  };
}

/**
 * Returns null (rather than throwing) if this message_id was already
 * recorded — the unique index on inbound_emails.message_id is the real
 * idempotency guarantee; this just lets a caller skip re-processing
 * without treating it as an error.
 */
export async function recordInboundEmail(input: {
  user_id: string;
  prospect_id?: string | null;
  message_id?: string | null;
  from_address: string;
  subject?: string | null;
  body?: string | null;
  classification: InboundClassification;
  handled: InboundHandled;
  note?: string | null;
}): Promise<InboundEmail | null> {
  const db = await getDb();
  const id = randomUUID();

  try {
    await db.execute({
      sql: `
        INSERT INTO inbound_emails (
          id, user_id, prospect_id, message_id, from_address, subject,
          body, classification, handled, note
        ) VALUES (
          @id, @user_id, @prospect_id, @message_id, @from_address, @subject,
          @body, @classification, @handled, @note
        )
      `,
      args: {
        id,
        user_id: input.user_id,
        prospect_id: input.prospect_id ?? null,
        message_id: input.message_id ?? null,
        from_address: input.from_address,
        subject: input.subject ?? null,
        body: input.body ?? null,
        classification: input.classification,
        handled: input.handled,
        note: input.note ?? null,
      },
    });
  } catch (error) {
    // Unique constraint violation on message_id — already processed.
    if (
      error instanceof Error &&
      /unique|duplicate/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }

  const result = await db.execute({
    sql: `SELECT * FROM inbound_emails WHERE id = ?`,
    args: [id],
  });

  return mapRow(result.rows[0] as unknown as Record<string, unknown>);
}

export async function listInboundEmailsForProspect(
  prospectId: string
): Promise<InboundEmail[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT * FROM inbound_emails WHERE prospect_id = ? ORDER BY received_at ASC`,
    args: [prospectId],
  });

  return (result.rows as unknown as Array<Record<string, unknown>>).map(mapRow);
}

/** All inbound messages for a user, for export/backup — not scoped to one prospect. */
export async function listAllInboundForExport(userId: string): Promise<InboundEmail[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM inbound_emails WHERE user_id = ? ORDER BY received_at ASC LIMIT 50000`,
    args: [userId],
  });
  return (result.rows as unknown as Array<Record<string, unknown>>).map(mapRow);
}
