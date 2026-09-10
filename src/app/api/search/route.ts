import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listProducts } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4J — platform-wide search, surfaced on the Dashboard.
 *
 * Complements the per-page searches on Prospects/Follow-ups/Products
 * (which filter already-loaded local data client-side) — this one
 * queries across entity types at once for "I know it's in here
 * somewhere, I just don't know which page" moments. Deliberately
 * capped per category (10 each) since this is meant for quickly
 * finding a specific thing, not for browsing — a huge result list
 * defeats the purpose.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (q.length < 2) {
      return NextResponse.json({ prospects: [], products: [], tasks: [] });
    }

    const db = await getDb();
    const pattern = `%${q}%`;

    const [prospectsResult, tasksResult, allProducts] = await Promise.all([
      db.execute({
        sql: `
          SELECT id, name, organization, email, qualification_status
          FROM prospects
          WHERE user_id = ?
            AND (name ILIKE ? OR organization ILIKE ? OR email ILIKE ?)
          ORDER BY created_at DESC
          LIMIT 10
        `,
        args: [LOCAL_USER_ID, pattern, pattern, pattern],
      }),
      db.execute({
        sql: `
          SELECT id, title, task_type, status
          FROM agent_tasks
          WHERE user_id = ?
            AND (title ILIKE ? OR description ILIKE ?)
          ORDER BY created_at DESC
          LIMIT 10
        `,
        args: [LOCAL_USER_ID, pattern, pattern],
      }),
      listProducts(),
    ]);

    const qLower = q.toLowerCase();
    const products = allProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(qLower) ||
          p.category?.toLowerCase().includes(qLower) ||
          p.description?.toLowerCase().includes(qLower)
      )
      .slice(0, 10)
      .map((p) => ({ id: p.id, name: p.name, category: p.category }));

    return NextResponse.json({
      prospects: prospectsResult.rows,
      tasks: tasksResult.rows,
      products,
    });
  } catch (error) {
    console.error("[api/search] GET failed:", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
