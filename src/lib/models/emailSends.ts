/**
 * MILESTONE 3F — Follow-up campaigns.
 *
 * One row per actually-attempted send. This is both the audit trail shown
 * in the Follow-ups view and the record a future round can look back on
 * (via listSendsForProspect) to avoid repeating itself.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

export interface EmailSend {
  id: string;
  user_id: string;
  prospect_id: string;
  task_id?: string;
  step: number;
  subject: string;
  body: string;
  status: "sent" | "failed";
  error_message?: string;
  sent_at: string;
}

function mapRow(row: Record<string, unknown>): EmailSend {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    prospect_id: String(row.prospect_id),
    task_id: row.task_id ? String(row.task_id) : undefined,
    step: Number(row.step),
    subject: String(row.subject),
    body: String(row.body),
    status: row.status === "failed" ? "failed" : "sent",
    error_message: row.error_message ? String(row.error_message) : undefined,
    sent_at: String(row.sent_at),
  };
}

export async function recordEmailSend(input: {
  user_id: string;
  prospect_id: string;
  task_id?: string | null;
  step: number;
  subject: string;
  body: string;
  status: "sent" | "failed";
  error_message?: string | null;
}): Promise<EmailSend> {
  const db = await getDb();
  const id = randomUUID();

  await db.execute({
    sql: `
      INSERT INTO email_sends (
        id, user_id, prospect_id, task_id, step, subject, body, status, error_message
      ) VALUES (
        @id, @user_id, @prospect_id, @task_id, @step, @subject, @body, @status, @error_message
      )
    `,
    args: {
      id,
      user_id: input.user_id,
      prospect_id: input.prospect_id,
      task_id: input.task_id ?? null,
      step: input.step,
      subject: input.subject,
      body: input.body,
      status: input.status,
      error_message: input.error_message ?? null,
    },
  });

  const result = await db.execute({
    sql: `SELECT * FROM email_sends WHERE id = ?`,
    args: [id],
  });

  return mapRow(result.rows[0] as unknown as Record<string, unknown>);
}

export async function listSendsForProspect(
  prospectId: string
): Promise<EmailSend[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT * FROM email_sends WHERE prospect_id = ? ORDER BY sent_at ASC`,
    args: [prospectId],
  });

  return (result.rows as unknown as Array<Record<string, unknown>>).map(
    mapRow
  );
}

/** Total successful sends today, across all prospects — for the daily send limit. */
export async function countSendsToday(userId: string): Promise<number> {
  const db = await getDb();
  const todayPrefix = `${new Date().toISOString().slice(0, 10)}%`;

  const result = await db.execute({
    sql: `
      SELECT COUNT(*) as c
      FROM email_sends
      WHERE user_id = ?
        AND status = 'sent'
        AND sent_at LIKE ?
    `,
    args: [userId, todayPrefix],
  });

  const row = result.rows[0] as unknown as { c: number | string } | undefined;
  return row ? Number(row.c) : 0;
}
