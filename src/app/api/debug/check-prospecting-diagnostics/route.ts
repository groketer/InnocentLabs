import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 7D — a direct, readable answer to a specific, live question:
 * did the model propose no candidates at all for a product, or did it
 * propose some and the competitor/audience-fit enforcement correctly
 * reject them? Reads the diagnostic fields added in MILESTONE 7C
 * directly off the most recent prospecting subtasks for a product.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productName = searchParams.get("product");

  if (!productName) {
    return noCacheJson({ error: "Pass ?product=Name in the URL." }, { status: 400 });
  }

  const db = await getDb();

  const result = await db.execute({
    sql: `
      SELECT title, result_json, completed_at
      FROM agent_tasks
      WHERE user_id = ?
        AND task_type = 'web_prospecting'
        AND title LIKE ?
      ORDER BY completed_at DESC NULLS LAST, created_at DESC
      LIMIT 8
    `,
    args: [LOCAL_USER_ID, `%${productName}%`],
  });

  const rows = result.rows as unknown as Array<{
    title: string;
    result_json: string | null;
    completed_at: string | null;
  }>;

  const parsed = rows.map((r) => {
    let data: Record<string, unknown> | null = null;
    try {
      data = r.result_json ? JSON.parse(r.result_json) : null;
    } catch {
      data = null;
    }
    return {
      title: r.title,
      completedAt: r.completed_at,
      rawCandidatesBeforeFiltering: data?.raw_candidates_before_filtering ?? "not present — this run predates the diagnostic fix",
      prospectsFound: data?.prospects_found ?? null,
      // MILESTONE 8J — the exact missing field behind a real, direct
      // confusion: prospects_found is candidates that passed all
      // filtering; prospects_persisted is what actually got newly
      // written to the database, after deduplication against existing
      // prospects. The two can genuinely differ, and only the first
      // one was visible here before this.
      prospectsPersisted: data?.prospects_persisted ?? null,
      rejectionBreakdown: data?.rejection_breakdown ?? null,
    };
  });

  return noCacheJson({ product: productName, recentSubtasks: parsed });
}
