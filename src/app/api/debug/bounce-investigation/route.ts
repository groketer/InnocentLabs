import { NextResponse } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 8B — a direct report of "bounces are way too many," checked
 * with real data rather than a guess. Breaks bounces down by product,
 * by prospect type (given the recent individuals-only push — personal
 * emails found via web search are often less verifiable than business
 * emails from a company's own site), and over time (to tell a
 * pre-existing pattern apart from something that just got worse).
 */
export async function GET() {
  const db = await getDb();

  const overall = await db.execute({
    sql: `
      SELECT
        COUNT(DISTINCT es.id) as total_sent,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.sequence_status = 'bounced') as total_bounced_prospects
      FROM email_sends es
      LEFT JOIN prospects pr ON pr.id = es.prospect_id
      WHERE es.user_id = ?
    `,
    args: [LOCAL_USER_ID],
  });

  const byProduct = await db.execute({
    sql: `
      SELECT
        p.name as product_name,
        COUNT(DISTINCT pr.id) as total_prospects,
        COUNT(DISTINCT es.id) as emails_sent,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.sequence_status = 'bounced') as bounced_prospects
      FROM prospects pr
      LEFT JOIN products p ON p.id = pr.product_id
      LEFT JOIN email_sends es ON es.prospect_id = pr.id
      WHERE pr.user_id = ?
      GROUP BY p.name
      ORDER BY bounced_prospects DESC
    `,
    args: [LOCAL_USER_ID],
  });

  const byProspectType = await db.execute({
    sql: `
      SELECT
        pr.prospect_type,
        COUNT(DISTINCT pr.id) as total_prospects,
        COUNT(DISTINCT es.id) as emails_sent,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.sequence_status = 'bounced') as bounced_prospects
      FROM prospects pr
      LEFT JOIN email_sends es ON es.prospect_id = pr.id
      WHERE pr.user_id = ?
      GROUP BY pr.prospect_type
    `,
    args: [LOCAL_USER_ID],
  });

  const recentTrend = await db.execute({
    sql: `
      SELECT
        DATE(pr.updated_at) as day,
        COUNT(*) as bounced_that_day
      FROM prospects pr
      WHERE pr.user_id = ? AND pr.sequence_status = 'bounced'
      GROUP BY DATE(pr.updated_at)
      ORDER BY day DESC
      LIMIT 14
    `,
    args: [LOCAL_USER_ID],
  }).catch(() => ({ rows: [] as unknown[] }));

  const overallRow = overall.rows[0] as unknown as { total_sent: number; total_bounced_prospects: number };
  const totalSent = Number(overallRow.total_sent);
  const totalBounced = Number(overallRow.total_bounced_prospects);

  return noCacheJson({
    note: "A healthy cold-outreach bounce rate is typically under 5%. Anything meaningfully higher points to a real, specific cause below, not just 'bounces happen.'",
    overallBounceRate: totalSent > 0 ? Number((totalBounced / totalSent).toFixed(3)) : null,
    totalEmailsSent: totalSent,
    totalBouncedProspects: totalBounced,
    byProduct: (byProduct.rows as unknown as Array<{
      product_name: string | null;
      total_prospects: number;
      emails_sent: number;
      bounced_prospects: number;
    }>).map((r) => ({
      productName: r.product_name ?? "(no product)",
      totalProspects: Number(r.total_prospects),
      emailsSent: Number(r.emails_sent),
      bouncedProspects: Number(r.bounced_prospects),
      bounceRate: Number(r.emails_sent) > 0 ? Number((Number(r.bounced_prospects) / Number(r.emails_sent)).toFixed(3)) : null,
    })),
    byProspectType: (byProspectType.rows as unknown as Array<{
      prospect_type: string;
      total_prospects: number;
      emails_sent: number;
      bounced_prospects: number;
    }>).map((r) => ({
      prospectType: r.prospect_type,
      totalProspects: Number(r.total_prospects),
      emailsSent: Number(r.emails_sent),
      bouncedProspects: Number(r.bounced_prospects),
      bounceRate: Number(r.emails_sent) > 0 ? Number((Number(r.bounced_prospects) / Number(r.emails_sent)).toFixed(3)) : null,
    })),
    recentTrendLast14Days: recentTrend.rows,
  });
}
