import { getDb } from "@/lib/db";

export interface DashboardStats {
  active_tasks: number;
  completed_today: number;
  prospects_total: number;
  prospects_qualified: number;
  prospects_needs_review: number;
  active_sequences: number;
  emails_sent_today: number;
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const db = await getDb();
  const todayPrefix = `${new Date().toISOString().slice(0, 10)}%`;

  const [
    activeTasks,
    completedToday,
    prospectsTotal,
    prospectsQualified,
    prospectsNeedsReview,
    activeSequences,
    emailsSentToday,
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
  ]);

  const c = (result: { rows: unknown[] }) =>
    Number((result.rows[0] as { c: number | string } | undefined)?.c ?? 0);

  return {
    active_tasks: c(activeTasks),
    completed_today: c(completedToday),
    prospects_total: c(prospectsTotal),
    prospects_qualified: c(prospectsQualified),
    prospects_needs_review: c(prospectsNeedsReview),
    active_sequences: c(activeSequences),
    emails_sent_today: c(emailsSentToday),
  };
}
