import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6D — the most serious possible consequence of the
 * duplicate-subtask bug: since email_campaign's planSubtasks() re-ran
 * many times for the same parent, each re-plan queried
 * listProspectsDueForOutreach() fresh and could easily have generated a
 * new subtask for the SAME prospect at the SAME step, if that prospect
 * hadn't advanced past "not_started" yet. If two such subtasks then
 * both actually ran, a real person could have received the same email
 * twice. This checks email_sends directly rather than assuming either
 * way.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const duplicates = await db.execute({
    sql: `
      SELECT prospect_id, step, COUNT(*) as send_count, MIN(sent_at) as first_sent, MAX(sent_at) as last_sent
      FROM email_sends
      WHERE user_id = ?
      GROUP BY prospect_id, step
      HAVING COUNT(*) > 1
      ORDER BY send_count DESC
    `,
    args: [LOCAL_USER_ID],
  });

  const withProspectNames = await Promise.all(
    (duplicates.rows as unknown as Array<{ prospect_id: string; step: number; send_count: number; first_sent: string; last_sent: string }>).map(
      async (d) => {
        const p = await db.execute({
          sql: `SELECT name, email FROM prospects WHERE id = ?`,
          args: [d.prospect_id],
        });
        const prospect = p.rows[0] as unknown as { name: string; email: string } | undefined;
        return { ...d, prospectName: prospect?.name ?? "(deleted)", prospectEmail: prospect?.email ?? null };
      }
    )
  );

  return noCacheJson({
    duplicateSendCount: withProspectNames.length,
    totalExtraEmailsSent: withProspectNames.reduce((sum, d) => sum + (Number(d.send_count) - 1), 0),
    duplicates: withProspectNames,
  });
}
