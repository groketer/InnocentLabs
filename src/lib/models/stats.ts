import { getDb } from "@/lib/db";

export interface DashboardAlert {
  severity: "critical" | "warning";
  message: string;
  count?: number;
}

export interface DashboardStats {
  active_tasks: number;
  completed_today: number;
  prospects_total: number;
  prospects_qualified: number;
  prospects_needs_review: number;
  active_sequences: number;
  emails_sent_today: number;

  // MILESTONE 4S — dashboard reporting overhaul.
  emails_first_contact_today: number;
  emails_follow_up_today: number;
  emails_replies_today: number;
  new_prospects_today: number;
  alerts: DashboardAlert[];
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const db = await getDb();
  const todayPrefix = `${new Date().toISOString().slice(0, 10)}%`;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const [
    activeTasks,
    completedToday,
    prospectsTotal,
    prospectsQualified,
    prospectsNeedsReview,
    activeSequences,
    emailsSentToday,
    emailsFirstContactToday,
    emailsFollowUpToday,
    emailsRepliesToday,
    newProspectsToday,
    failedTasksLast24h,
    needsHumanReply,
    needsProduct,
    stuckTasks,
    tickInfo,
    apiUsageAnomaly,
  ] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as c FROM agent_tasks WHERE user_id = ? AND parent_task_id IS NULL AND status IN ('QUEUED','RUNNING')`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM agent_tasks WHERE user_id = ? AND parent_task_id IS NULL AND status IN ('COMPLETED','COMPLETED_WITH_ISSUES') AND completed_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ?`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND qualification_status = 'qualified'`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND qualification_status = 'needs_review'`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status IN ('active','pending_approval')`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND sent_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND direction = 'outbound' AND step = 0 AND sent_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND direction = 'outbound' AND step > 0 AND sent_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM email_sends WHERE user_id = ? AND status = 'sent' AND direction = 'reply' AND sent_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND created_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM agent_tasks WHERE user_id = ? AND status = 'FAILED' AND updated_at > ?`,
      args: [userId, oneDayAgo],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'needs_human_reply'`,
      args: [userId],
    }),
    db.execute({
      // MILESTONE 5M — a real, confirmed labeling bug this fixes:
      // needs_human_reply was being reused for prospects with no valid
      // product assigned — a completely different situation with
      // nothing to do with replying to anyone. This directly confused
      // a real user, who correctly couldn't find anything needing a
      // reply among prospects that actually needed a product. Split
      // into its own genuinely distinct status and alert.
      sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'needs_product'`,
      args: [userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as c FROM agent_tasks WHERE user_id = ? AND status = 'RUNNING' AND started_at < ?`,
      args: [userId, twoHoursAgo],
    }),
    db.execute(`SELECT value FROM app_meta WHERE key = 'last_tick_at'`),
    // MILESTONE 6F — automatic API usage anomaly detection, built after
    // a real, confirmed incident this session: a duplicate-planning bug
    // spiked hourly API calls from a normal 7-49/hour up to 319/hour
    // before anyone noticed, purely because nobody happened to check a
    // diagnostic URL at the right moment. This removes that dependency
    // on manual vigilance — comparing the current hour's call count
    // against the recent baseline directly, on every Dashboard load.
    db.execute({
      sql: `
        WITH current_hour AS (
          SELECT COUNT(*) as c
          FROM api_usage
          WHERE user_id = ? AND created_at >= to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ),
        hourly_baseline AS (
          SELECT date_trunc('hour', created_at::timestamptz) as hour_bucket, COUNT(*) as c
          FROM api_usage
          WHERE user_id = ?
            AND created_at >= to_char(now() - interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            AND created_at < to_char(date_trunc('hour', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          GROUP BY hour_bucket
        )
        SELECT
          (SELECT c FROM current_hour) as current_hour_calls,
          COALESCE((SELECT AVG(c) FROM hourly_baseline), 0) as baseline_avg_calls_per_hour
      `,
      args: [userId, userId],
    }),
  ]);

  const c = (result: { rows: unknown[] }) =>
    Number((result.rows[0] as { c: number | string } | undefined)?.c ?? 0);

  const alerts: DashboardAlert[] = [];

  const failedCount = c(failedTasksLast24h);
  if (failedCount > 0) {
    alerts.push({
      severity: "critical",
      message: `${failedCount} task${failedCount === 1 ? "" : "s"} failed in the last 24 hours.`,
      count: failedCount,
    });
  }

  const needsReplyCount = c(needsHumanReply);
  if (needsReplyCount > 0) {
    alerts.push({
      severity: "warning",
      message: `${needsReplyCount} prospect${needsReplyCount === 1 ? "" : "s"} escalated for a human reply.`,
      count: needsReplyCount,
    });
  }

  const needsProductCount = c(needsProduct);
  if (needsProductCount > 0) {
    alerts.push({
      severity: "warning",
      message: `${needsProductCount} prospect${needsProductCount === 1 ? "" : "s"} need${needsProductCount === 1 ? "s" : ""} a product assigned before outreach can continue.`,
      count: needsProductCount,
    });
  }

  const stuckCount = c(stuckTasks);
  if (stuckCount > 0) {
    alerts.push({
      severity: "critical",
      message: `${stuckCount} task${stuckCount === 1 ? "" : "s"} have been running for over 2 hours without completing — likely stuck.`,
      count: stuckCount,
    });
  }

  const lastTickRow = tickInfo.rows[0] as { value: string } | undefined;
  if (lastTickRow?.value) {
    const secondsSinceTick = (Date.now() - new Date(lastTickRow.value).getTime()) / 1000;
    if (secondsSinceTick > 3600) {
      alerts.push({
        severity: "critical",
        message: `No tick recorded in over an hour (last: ${Math.round(secondsSinceTick / 60)} minutes ago) — automation may not be running.`,
      });
    }
  } else {
    alerts.push({
      severity: "warning",
      message: "No tick has ever been recorded — automation may never have run.",
    });
  }

  // MILESTONE 6F — the actual anomaly check. Two conditions, both
  // required, deliberately: an absolute floor (calls_this_hour > 100)
  // so a quiet baseline near zero doesn't make ordinary, modest
  // activity look like a "300% spike" over nothing; and a relative
  // multiplier (3x the recent baseline) so this stays meaningful even
  // if genuine, legitimate usage grows over time and a higher hourly
  // rate becomes the new normal. The real incident this is built from
  // showed 319 calls in one hour against a same-day baseline in the
  // 7-49 range — comfortably clears both thresholds together, while a
  // single busy-but-normal hour should clear neither.
  const usageAnomalyRow = apiUsageAnomaly.rows[0] as
    | { current_hour_calls: number | string; baseline_avg_calls_per_hour: number | string }
    | undefined;
  const currentHourCalls = Number(usageAnomalyRow?.current_hour_calls ?? 0);
  const baselineAvg = Number(usageAnomalyRow?.baseline_avg_calls_per_hour ?? 0);
  if (currentHourCalls > 100 && currentHourCalls > baselineAvg * 3) {
    alerts.push({
      severity: "critical",
      message: `${currentHourCalls} API calls in the last hour — well above the recent baseline (~${Math.round(baselineAvg)}/hour). This is what a runaway task looks like — worth checking Activity before it runs up further cost.`,
      count: currentHourCalls,
    });
  }

  return {
    active_tasks: c(activeTasks),
    completed_today: c(completedToday),
    prospects_total: c(prospectsTotal),
    prospects_qualified: c(prospectsQualified),
    prospects_needs_review: c(prospectsNeedsReview),
    active_sequences: c(activeSequences),
    emails_sent_today: c(emailsSentToday),
    emails_first_contact_today: c(emailsFirstContactToday),
    emails_follow_up_today: c(emailsFollowUpToday),
    emails_replies_today: c(emailsRepliesToday),
    new_prospects_today: c(newProspectsToday),
    alerts,
  };
}
