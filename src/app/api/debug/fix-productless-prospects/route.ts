import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { updateProspectSequence } from "@/lib/models/prospects";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 5B — one-time cleanup for prospects already caught by the
 * missing/invalid product_id bug fixed in emailCampaign.ts. That fix
 * only prevents this happening going forward — prospects already stuck
 * with sequence_status = 'not_started' and no valid product will keep
 * matching listProspectsDueForOutreach() and retrying forever until
 * fixed here.
 *
 * GET first to preview affected prospects without changing anything.
 * POST to actually advance them to needs_human_reply — a real,
 * dashboard-monitored status — so each becomes a one-time, actionable
 * item instead of a silent daily failure.
 */
async function findBrokenProspects() {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      SELECT prospects.id, prospects.name, prospects.product_id, prospects.qualification_status
      FROM prospects
      LEFT JOIN products ON products.id = prospects.product_id
      WHERE prospects.user_id = ?
        AND prospects.qualification_status = 'qualified'
        AND prospects.sequence_status = 'not_started'
        AND (prospects.product_id IS NULL OR products.id IS NULL)
    `,
    args: [LOCAL_USER_ID],
  });

  return result.rows as unknown as Array<{
    id: string;
    name: string;
    product_id: string | null;
    qualification_status: string;
  }>;
}

export async function GET(_req: NextRequest) {
  const broken = await findBrokenProspects();
  return noCacheJson({
    dryRun: true,
    affectedCount: broken.length,
    prospects: broken,
    note: "This is a preview only — nothing changed. POST to this same URL to actually fix them.",
  });
}

export async function POST(_req: NextRequest) {
  const broken = await findBrokenProspects();
  const fixed: string[] = [];

  for (const p of broken) {
    await updateProspectSequence(LOCAL_USER_ID, p.id, {
      sequence_status: "needs_human_reply",
    });
    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: null,
      event_type: "TASK_RECOVERY",
      message: `${p.name}: flagged for review — was retrying outreach every day with no valid product assigned.`,
    });
    fixed.push(p.name);
  }

  return noCacheJson({
    fixedCount: fixed.length,
    fixed,
    note: "These now show under Follow-ups' escalated/needs-review state, and the Dashboard's alerts. Assign a real product (or delete) to resolve each.",
  });
}
