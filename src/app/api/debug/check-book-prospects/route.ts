import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4Z — the agent repeatedly claimed prospects for "Patterns of
 * Opportunity" were successfully found, then "assigned", yet they never
 * appeared on the Prospects page. Checks the actual, current database
 * state directly rather than trusting either the agent's claim or
 * guessing at a UI/cache issue: does the product exist, how many
 * prospects actually have its product_id right now, and what tasks
 * were actually run that claimed to do this work (including their real
 * task_type, since create_task can only run REGISTERED executors — if
 * the agent said "created a task to associate prospects" but no such
 * executor exists, whatever task actually ran did something else
 * entirely, not what was promised).
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const product = await db.execute({
    sql: `SELECT id, name FROM products WHERE name ILIKE '%patterns of opportunity%'`,
  });
  const productRow = product.rows[0] as unknown as { id: string; name: string } | undefined;

  if (!productRow) {
    return noCacheJson({ error: "Product not found at all." });
  }

  const prospectsForProduct = await db.execute({
    sql: `SELECT id, name, qualification_status, created_at, updated_at FROM prospects WHERE product_id = ? ORDER BY updated_at DESC`,
    args: [productRow.id],
  });

  const recentTasksMentioningBook = await db.execute({
    sql: `
      SELECT id, title, task_type, status, created_at, completed_at, result_summary
      FROM agent_tasks
      WHERE user_id = ?
        AND (title ILIKE '%patterns of opportunity%' OR description ILIKE '%patterns of opportunity%')
      ORDER BY created_at DESC
      LIMIT 15
    `,
    args: [LOCAL_USER_ID],
  });

  // Prospects whose evidence/fit_reason mentions the book but whose
  // product_id points somewhere else entirely — the most direct way to
  // catch "found the right prospects, linked them to the wrong product".
  const mislinkedProspects = await db.execute({
    sql: `
      SELECT id, name, product_id, fit_reason
      FROM prospects
      WHERE user_id = ?
        AND product_id != ?
        AND (fit_reason ILIKE '%opportunity%' OR evidence ILIKE '%patterns of opportunity%')
      LIMIT 20
    `,
    args: [LOCAL_USER_ID, productRow.id],
  });

  return noCacheJson({
    product: productRow,
    prospectsCurrentlyLinkedToThisProduct: {
      count: prospectsForProduct.rows.length,
      rows: prospectsForProduct.rows,
    },
    recentTasksThatMentionedTheBook: recentTasksMentioningBook.rows,
    prospectsThatMentionOpportunityButLinkedElsewhere: mislinkedProspects.rows,
  });
}
