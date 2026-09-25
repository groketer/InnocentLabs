import { NextResponse } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";
import { getSettings } from "@/lib/models/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 8Q — a direct check of the real state behind two reported
 * dashboard symptoms (follow-ups not showing, first-contact stuck at
 * 40), rather than theorizing further. The allocation logic and the
 * dashboard's rendering code both look structurally correct on
 * inspection — this surfaces the actual current numbers so we're
 * fixing a real, confirmed cause rather than a guess.
 */
export async function GET() {
  const db = await getDb();
  const settings = await getSettings();
  const nowIso = new Date().toISOString();
  const todayPrefix = `${new Date().toISOString().slice(0, 10)}%`;

  const [
    dueFollowUpsNow,
    activeSequencesTotal,
    activeSequencesWithNoNextSend,
    todaySendsByStep,
    sentTodayTotal,
  ] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'active' AND next_send_at IS NOT NULL AND next_send_at <= ?`,
      args: [LOCAL_USER_ID, nowIso],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'active'`,
      args: [LOCAL_USER_ID],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'active' AND next_send_at IS NULL`,
      args: [LOCAL_USER_ID],
    }),
    db.execute({
      sql: `SELECT step, COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND direction = 'outbound' AND sent_at LIKE ? GROUP BY step ORDER BY step`,
      args: [LOCAL_USER_ID, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND sent_at LIKE ?`,
      args: [LOCAL_USER_ID, todayPrefix],
    }),
  ]);

  return noCacheJson({
    note: "dueFollowUpsNow is the real, current answer to 'are follow-ups actually available to send right now' - if this is 0, the dashboard showing 0 follow-ups sent today is accurate, not a bug.",
    dueFollowUpsRightNow: Number((dueFollowUpsNow.rows[0] as { c: number }).c),
    activeSequencesTotal: Number((activeSequencesTotal.rows[0] as { c: number }).c),
    activeSequencesWithNoNextSendSet: Number((activeSequencesWithNoNextSend.rows[0] as { c: number }).c),
    todaySendsByStep: todaySendsByStep.rows,
    sentTodayTotal: Number((sentTodayTotal.rows[0] as { c: number }).c),
    dailySendLimit: settings.daily_send_limit,
    minDaysBetweenFollowUps: settings.min_days_between_follow_ups,
  });
}
