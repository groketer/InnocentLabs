import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 8K — a direct, real answer to a real, confirmed
 * contradiction: every prospect in a batch was an organization,
 * despite the individuals-only structural filter that should hard-
 * reject exactly that. rejected_as_organization_individuals_only was
 * 0 in every round, meaning the filter caught nothing — which points
 * to the flag not actually being set, not a bug in the filter logic
 * itself. This checks the real, current database value directly,
 * rather than guessing which explanation is right.
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
      SELECT id, name, require_individual_prospects, audience, updated_at
      FROM products
      WHERE user_id = ? AND name = ?
    `,
    args: [LOCAL_USER_ID, productName],
  });

  const row = result.rows[0] as unknown as
    | {
        id: string;
        name: string;
        require_individual_prospects: unknown;
        audience: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return noCacheJson({ error: `No product found named "${productName}".` }, { status: 404 });
  }

  return noCacheJson({
    product: row.name,
    // The raw value and its JS type, not just a boolean re-interpretation —
    // if this isn't literally `true` (boolean), that's the actual answer.
    require_individual_prospects_raw_value: row.require_individual_prospects,
    require_individual_prospects_type: typeof row.require_individual_prospects,
    require_individual_prospects_is_truthy: Boolean(row.require_individual_prospects),
    audience: row.audience,
    lastUpdated: row.updated_at,
  });
}
