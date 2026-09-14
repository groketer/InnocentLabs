import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6P — a real, direct request: which product actually has the
 * most market signal, given none have external traction (revenue,
 * customers) yet. The closest available proxy is genuine reply
 * behavior — a real person responding to real outreach is a much
 * stronger signal than prospect volume or qualification rate alone,
 * since qualification reflects how findable an audience is, not
 * whether that audience actually responds once reached.
 */
export async function GET(_req: NextRequest) {
  const db = await getDb();

  const report = await db.execute({
    sql: `
      SELECT
        p.id as product_id,
        p.name as product_name,
        COUNT(DISTINCT pr.id) as total_prospects,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.qualification_status = 'qualified') as qualified_prospects,
        COUNT(DISTINCT es.id) as emails_sent,
        COUNT(DISTINCT ie.id) FILTER (WHERE ie.classification = 'reply') as genuine_replies,
        COUNT(DISTINCT ie.id) FILTER (WHERE ie.classification = 'reply' AND ie.reply_interest = 'genuine_interest') as replies_showing_real_interest,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.sequence_status = 'bounced') as bounced_prospects,
        COUNT(DISTINCT pr.id) FILTER (WHERE pr.sequence_status = 'unsubscribed') as unsubscribed_prospects
      FROM products p
      LEFT JOIN prospects pr ON pr.product_id = p.id AND pr.user_id = @user_id
      LEFT JOIN email_sends es ON es.prospect_id = pr.id
      LEFT JOIN inbound_emails ie ON ie.prospect_id = pr.id
      GROUP BY p.id, p.name
      ORDER BY replies_showing_real_interest DESC, genuine_replies DESC, emails_sent DESC
    `,
    args: { user_id: LOCAL_USER_ID },
  });

  const rows = (report.rows as unknown as Array<{
    product_id: string;
    product_name: string;
    total_prospects: number | string;
    qualified_prospects: number | string;
    emails_sent: number | string;
    genuine_replies: number | string;
    replies_showing_real_interest: number | string;
    bounced_prospects: number | string;
    unsubscribed_prospects: number | string;
  }>).map((r) => {
    const emailsSent = Number(r.emails_sent);
    const replies = Number(r.genuine_replies);
    const realInterest = Number(r.replies_showing_real_interest);
    return {
      productId: r.product_id,
      productName: r.product_name,
      totalProspects: Number(r.total_prospects),
      qualifiedProspects: Number(r.qualified_prospects),
      emailsSent,
      genuineReplies: replies,
      repliesShowingRealInterest: realInterest,
      replyRate: emailsSent > 0 ? Number((replies / emailsSent).toFixed(3)) : null,
      realInterestRate: emailsSent > 0 ? Number((realInterest / emailsSent).toFixed(3)) : null,
      bouncedProspects: Number(r.bounced_prospects),
      unsubscribedProspects: Number(r.unsubscribed_prospects),
    };
  });

  return noCacheJson({
    note: "No product has external traction (revenue/customers) yet, per direct confirmation. IMPORTANT: 'genuineReplies' only means a real person replied — it does NOT mean they were interested (a reverse pitch or a flat decline both count). 'repliesShowingRealInterest' and 'realInterestRate' are the actual signal to weigh a decision on — confirmed necessary after two earlier 'genuine replies' both turned out, on direct review, not to reflect real interest at all.",
    products: rows,
  });
}
