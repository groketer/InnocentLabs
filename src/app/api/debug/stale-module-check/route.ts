import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { listActiveSequences } from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4O — proves (or disproves) the stale-build-artifact theory.
 *
 * The live repo's listActiveSequences() includes 'in_conversation' in
 * its status list, yet the deployed runtime behaves as though it
 * doesn't — while a raw query with a byte-identical WHERE clause finds
 * the row fine. That points at Vercel reusing a cached compiled chunk
 * of prospects.ts from an earlier build, so a brand-new route compiles
 * fresh while the older module keeps being reused.
 *
 * This runs the SAME SQL inline, in this file (guaranteed freshly
 * compiled), and compares it against what the imported module returns.
 * If inline finds the row and the module doesn't, the module deployed
 * is genuinely out of date and a clean rebuild is the fix.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const inlineResult = await db.execute({
    sql: `
      SELECT id, name, sequence_status
      FROM prospects
      WHERE user_id = @user_id
        AND sequence_status IN ('pending_approval', 'active', 'completed', 'responded', 'unsubscribed', 'paused', 'in_conversation', 'needs_human_reply', 'bounced')
      ORDER BY
        CASE sequence_status
          WHEN 'needs_human_reply' THEN 0
          WHEN 'pending_approval' THEN 1
          WHEN 'in_conversation' THEN 2
          WHEN 'active' THEN 3
          WHEN 'paused' THEN 4
          WHEN 'responded' THEN 5
          WHEN 'completed' THEN 6
          WHEN 'bounced' THEN 7
          WHEN 'unsubscribed' THEN 8
          ELSE 9
        END,
        updated_at DESC
      LIMIT 200
    `,
    args: { user_id: LOCAL_USER_ID },
  });

  const inlineRows = inlineResult.rows as unknown as Array<{
    id: string;
    name: string;
    sequence_status: string;
  }>;

  const moduleRows = await listActiveSequences(LOCAL_USER_ID);

  const countByStatus = (rows: { sequence_status: string }[]) =>
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.sequence_status] = (acc[r.sequence_status] ?? 0) + 1;
      return acc;
    }, {});

  return noCacheJson({
    serverTimestamp: new Date().toISOString(),

    inlineSqlTotal: inlineRows.length,
    inlineSqlStatusBreakdown: countByStatus(inlineRows),
    inlineSqlFirstThree: inlineRows.slice(0, 3),

    importedModuleTotal: moduleRows.length,
    importedModuleStatusBreakdown: countByStatus(moduleRows),
    importedModuleFirstThree: moduleRows
      .slice(0, 3)
      .map((r) => ({ id: r.id, name: r.name, sequence_status: r.sequence_status })),

    verdict:
      inlineRows.length !== moduleRows.length
        ? "MISMATCH — the deployed prospects.ts module is stale. A clean rebuild (redeploy without build cache) should fix it."
        : "Both agree — the stale-module theory is wrong, look elsewhere.",
  });
}
