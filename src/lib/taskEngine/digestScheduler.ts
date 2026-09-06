/**
 * MILESTONE 3L — improvement #6: periodic digest.
 *
 * A daily summary of what actually happened, sent to Innocent's own inbox
 * (reusing notifyOwner / BCC_NOTIFICATION_EMAILS) — the point of
 * autonomy is not needing to actively check the dashboard to know
 * whether things are working.
 *
 * Summarizes the PREVIOUS calendar day (UTC), not "today" — this runs
 * early in the day via the daily cron, so "today" would still be almost
 * entirely empty. Idempotent per day via app_meta, same pattern as the
 * other schedulers, so it's safe to be called from every cron run without
 * risk of sending twice.
 */

import { getDb } from "@/lib/db";
import { notifyOwner } from "@/lib/email/notifyOwner";
import { LOCAL_USER_ID } from "@/lib/localUser";

const DIGEST_LAST_SENT_KEY = "digest_last_sent_date";

function yesterdayDateKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function alreadySentToday(): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT value FROM app_meta WHERE key = ?`,
    args: [DIGEST_LAST_SENT_KEY],
  });
  const row = result.rows[0] as unknown as { value: string } | undefined;
  return row?.value === new Date().toISOString().slice(0, 10);
}

async function markSentToday(): Promise<void> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  await db.execute({
    sql: `
      INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `,
    args: [DIGEST_LAST_SENT_KEY, today],
  });
}

interface DigestStats {
  prospects_found: number;
  qualified: number;
  emails_sent: number;
  replies_received: number;
  bounces: number;
  escalations: number;
  cost: number;
}

async function computeYesterdayStats(userId: string): Promise<DigestStats> {
  const db = await getDb();
  const dayPrefix = `${yesterdayDateKey()}%`;

  const [prospects, qualified, sends, replies, bounces, escalations, cost] =
    await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND created_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND qualification_status = 'qualified' AND updated_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND direction = 'outbound' AND sent_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as c FROM inbound_emails WHERE user_id = ? AND classification = 'reply' AND received_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as c FROM inbound_emails WHERE user_id = ? AND classification = 'bounce' AND received_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as c FROM inbound_emails WHERE user_id = ? AND handled = 'escalated' AND received_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
      db.execute({
        sql: `SELECT COALESCE(SUM(estimated_cost_usd),0) as c FROM api_usage WHERE user_id = ? AND created_at LIKE ?`,
        args: [userId, dayPrefix],
      }),
    ]);

  const num = (r: { rows: unknown[] }) =>
    Number((r.rows[0] as { c: number | string } | undefined)?.c ?? 0);

  return {
    prospects_found: num(prospects),
    qualified: num(qualified),
    emails_sent: num(sends),
    replies_received: num(replies),
    bounces: num(bounces),
    escalations: num(escalations),
    cost: num(cost),
  };
}

export async function sendDailyDigestIfDue(): Promise<void> {
  if (await alreadySentToday()) {
    return;
  }

  try {
    const stats = await computeYesterdayStats(LOCAL_USER_ID);

    // Skip sending an empty digest on a genuinely quiet day — still marks
    // as sent so it doesn't try again later today.
    const hadActivity =
      stats.prospects_found > 0 ||
      stats.emails_sent > 0 ||
      stats.replies_received > 0;

    if (hadActivity) {
      const lines = [
        `Yesterday (${yesterdayDateKey()}):`,
        "",
        `${stats.prospects_found} new prospect${stats.prospects_found === 1 ? "" : "s"} found`,
        `${stats.qualified} qualified`,
        `${stats.emails_sent} email${stats.emails_sent === 1 ? "" : "s"} sent`,
        `${stats.replies_received} repl${stats.replies_received === 1 ? "y" : "ies"} received`,
        `${stats.bounces} bounce${stats.bounces === 1 ? "" : "s"}`,
        `${stats.escalations} flagged for your attention`,
        "",
        `Estimated AI cost: $${stats.cost.toFixed(3)}`,
        "",
        "Open the app for the full picture — Dashboard, Follow-ups, Products.",
      ];

      await notifyOwner("Daily summary", lines.join("\n"));
    }

    await markSentToday();
  } catch (error) {
    console.error("[digestScheduler] Could not send daily digest:", error);
  }
}
