/**
 * MILESTONE 3L — improvement #4: "what's actually working."
 *
 * Per-product funnel: how many prospects were found, how many qualified,
 * how many got emailed, how many replied, how many bounced. The
 * difference between a system that does tasks and one that helps decide
 * where to focus.
 */

import { getDb } from "@/lib/db";

export interface ProductInsight {
  product_id: string;
  product_name: string;
  prospects_found: number;
  qualified: number;
  emailed: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

export async function getInsightsByProduct(userId: string): Promise<ProductInsight[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      SELECT
        p.product_id,
        pr.name as product_name,
        COUNT(*) as prospects_found,
        COUNT(*) FILTER (WHERE p.qualification_status = 'qualified') as qualified,
        COUNT(*) FILTER (WHERE p.emails_sent > 0) as emailed,
        COUNT(*) FILTER (WHERE p.sequence_status IN ('in_conversation','responded')) as replied,
        COUNT(*) FILTER (WHERE p.sequence_status = 'bounced') as bounced,
        COUNT(*) FILTER (WHERE p.sequence_status = 'unsubscribed') as unsubscribed
      FROM prospects p
      LEFT JOIN products pr ON pr.id = p.product_id
      WHERE p.user_id = ? AND p.product_id IS NOT NULL
      GROUP BY p.product_id, pr.name
      ORDER BY prospects_found DESC
    `,
    args: [userId],
  });

  return (
    result.rows as unknown as Array<{
      product_id: string;
      product_name: string | null;
      prospects_found: number | string;
      qualified: number | string;
      emailed: number | string;
      replied: number | string;
      bounced: number | string;
      unsubscribed: number | string;
    }>
  ).map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name ?? "(unknown product)",
    prospects_found: Number(r.prospects_found),
    qualified: Number(r.qualified),
    emailed: Number(r.emailed),
    replied: Number(r.replied),
    bounced: Number(r.bounced),
    unsubscribed: Number(r.unsubscribed),
  }));
}
