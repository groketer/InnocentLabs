/**
 * Authoritative Innocent Labs portfolio model.
 *
 * Milestone 3D - Live portfolio awareness.
 *
 * The public Innocent Labs marketplace at https://innocent.co.ke is now the
 * live discovery source for the current portfolio.
 *
 * IMPORTANT:
 *
 * - The website is used to discover current portfolio entries.
 * - Historical / discontinued assets are retained.
 * - Existing intelligence fields are never overwritten by portfolio refresh.
 * - A website discovery is not automatically treated as proof of commercial
 *   performance, customer demand, or buying intent.
 * - The intelligence layer must distinguish portfolio facts, direct website
 *   observations, interpretations, and unknowns.
 *
 * MILESTONE 3E — VERCEL:
 * Every function here is now async because the underlying Postgres
 * connection (Postgres via @neondatabase/serverless) is async. See src/lib/db.ts.
 * See src/lib/db.ts for why.
 */

import { randomUUID } from "crypto";
import { getDb, NOW_ISO_SQL } from "@/lib/db";
import type { InArgs } from "@/lib/db";
import type { Product } from "@/lib/types";

/**
 * The manually maintained fallback portfolio.
 *
 * This remains useful as the bootstrap/fallback portfolio and as a record of
 * products that Innocent has explicitly established for the system.
 *
 * The live portfolio refresh can add newly discovered products from
 * innocent.co.ke without requiring this array to be edited first.
 */
export const AUTHORITATIVE_PORTFOLIO: Array<{
  name: string;
  url: string;
  asset_type: "product" | "hub";
  category: string;
  description: string;
  status: Product["status"];
  future_url?: string | null;
  notes?: string | null;
}> = [
  {
    name: "Tiny Wins",
    url: "https://pbsolved.com",
    asset_type: "product",
    category: "personal growth / productivity",
    description:
      "A platform centered on tracking and celebrating small wins.",
    status: "active",
  },

  {
    name: "Future Me",
    url: "https://futureme.co.ke",
    asset_type: "product",
    category: "coaching / self-development",
    description:
      "A coaching app connecting users with their Future Self through reflection, AI insights and personalized guidance.",
    status: "active",
  },

  {
    name: "AIStruck",
    url: "https://aistruck.com",
    asset_type: "product",
    category: "AI coaching / online income",
    description:
      "An AI mentor for building an online income stream through structured missions, guidance and accountability.",
    status: "active",
  },

  {
    name: "UHIKO Properties",
    url: "https://uhiko.com",
    asset_type: "product",
    category: "real estate services",
    description:
      "Real estate business and property services platform.",
    status: "active",
  },

  {
    name: "PRFed",
    url: "https://prfed.com",
    asset_type: "product",
    category: "AI writing / editing",
    description:
      "AI Writing Coach plus professional editors for essay analysis, proofing, humanizing and citation support.",
    status: "active",
  },

  {
    name: "Lnkstrap",
    url: "https://lnkstrap.com",
    asset_type: "product",
    category: "links / marketing",
    description:
      "Link management product; detailed capabilities are to be verified by website intelligence.",
    status: "active",
  },

  {
    name: "Creator Freedom System",
    url: "https://pesamfukoni.com",
    asset_type: "product",
    category: "creator monetization",
    description:
      "Creator-focused system; detailed offer and positioning are to be verified by website intelligence.",
    status: "active",
  },

  {
    name: "Compatibility Predictor",
    url: "https://groketer.com/compatibility-predictor/",
    future_url: "https://predict.groketer.com",
    asset_type: "product",
    category: "compatibility / matching",
    description:
      "Compatibility prediction product currently being expanded.",
    status: "improving",
    notes:
      "Current public location is the groketer.com path; planned new home is predict.groketer.com.",
  },

  {
    name: "RealtyPro",
    url: "https://uhiko.com/realtypro/",
    asset_type: "product",
    category: "WordPress theme / real estate technology",
    description:
      "A full-featured real estate website solution with MLS-style listings, WhatsApp lead import with AI scoring, PDF brochures, lead management and an agent portal.",
    status: "active",
  },

  {
    name: "LilaBook",
    url: "https://lilabook.com",
    asset_type: "product",
    category: "story sharing",
    description:
      "A platform for sharing stories, experiences and related personal content.",
    status: "active",
  },

  {
    name: "Groketer",
    url: "https://groketer.com",
    asset_type: "product",
    category: "WordPress SEO / marketing tools",
    description:
      "A suite of SEO WordPress plugins and related marketing tools.",
    status: "active",
  },

  {
    name: "MasterStream",
    url: "https://masterstream-cquq6uaj.manus.space/",
    asset_type: "product",
    category: "audio / media",
    description:
      "Audio/media product currently deployed temporarily and requiring future deployment improvements.",
    status: "temporary",
  },

  {
    name: "First Income Clarity",
    url: "https://groketer.com/firstincome/",
    asset_type: "product",
    category: "income guidance",
    description:
      "A product focused on helping users gain clarity around earning their first income.",
    status: "active",
  },

  {
    name: "Inno",
    url: "https://inno.prfed.com/",
    asset_type: "product",
    category: "AI voice generation",
    description:
      "Create professional AI voiceovers in seconds.",
    status: "active",
  },

  {
    name: "Innocent Stories",
    url: "https://stories.innocent.co.ke/",
    asset_type: "product",
    category: "storytelling / content",
    description:
      "A storytelling platform for sharing stories and experiences.",
    status: "active",
  },

  {
    name: "Groketer Mail Drip",
    url: "https://drip.groketer.com/",
    asset_type: "product",
    category: "email marketing",
    description:
      "An email drip/automation product under the Groketer ecosystem.",
    status: "active",
  },

  {
    name: "LinkedIn Domination Masterclass",
    url: "https://82ad-innocent.systeme.io/linkedin-course",
    asset_type: "product",
    category: "training / LinkedIn marketing",
    description:
      "A masterclass focused on LinkedIn growth and marketing.",
    status: "active",
  },
];

/**
 * Historical assets remain in the database for continuity and historical
 * intelligence, but they are NOT eligible for autonomous execution.
 */
const HISTORICAL_ASSETS = [
  "TodayIWON",
  "YouGetPaid247 / Legacy Builders Program",
  "Pesamfukoni",
];

/**
 * Adds a column to an existing development database when it does not exist.
 */
async function ensureColumn(
  column: string,
  definition: string
): Promise<void> {
  const db = await getDb();

  const columns = (
    await db.execute(`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_name = 'products'
    `)
  ).rows as unknown as Array<{ name: string }>;

  if (!columns.some((c) => c.name === column)) {
    await db.execute(
      `ALTER TABLE products ADD COLUMN ${column} ${definition}`
    );
  }
}

/**
 * Reconciles the manually maintained bootstrap portfolio with the database.
 *
 * IMPORTANT:
 *
 * This function does not delete unknown products and does not overwrite
 * intelligence fields gathered by website audits.
 */
export async function syncAuthoritativePortfolio(): Promise<void> {
  const db = await getDb();

  await ensureColumn("asset_type", "TEXT NOT NULL DEFAULT 'product'");
  await ensureColumn("category", "TEXT NOT NULL DEFAULT 'unknown'");
  await ensureColumn("description", "TEXT");
  await ensureColumn("future_url", "TEXT");
  await ensureColumn("notes", "TEXT");

  await ensureColumn("problem", "TEXT");
  await ensureColumn("audience", "TEXT");
  await ensureColumn("positioning", "TEXT");
  await ensureColumn("features", "TEXT");
  await ensureColumn("commercial_model", "TEXT");
  await ensureColumn("pricing", "TEXT");
  await ensureColumn("cta", "TEXT");
  await ensureColumn("evidence", "TEXT");
  await ensureColumn("unknowns", "TEXT");
  await ensureColumn("confidence", "REAL");
  await ensureColumn("last_audited_at", "TEXT");

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_unique
    ON products(name)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const upsertSql = `
    INSERT INTO products (
      id,
      name,
      url,
      status,
      asset_type,
      category,
      description,
      future_url,
      notes
    )
    VALUES (
      @id,
      @name,
      @url,
      @status,
      @asset_type,
      @category,
      @description,
      @future_url,
      @notes
    )
    ON CONFLICT(name) DO UPDATE SET
      url = excluded.url,
      status = excluded.status,
      asset_type = excluded.asset_type,
      category = excluded.category,
      description = excluded.description,
      future_url = excluded.future_url,
      notes = excluded.notes,
      updated_at = ${NOW_ISO_SQL}
  `;

  const markHistoricalSql = `
    UPDATE products
    SET
      status = 'discontinued',
      updated_at = ${NOW_ISO_SQL}
    WHERE name = @name
  `;

  /*
   * All product upserts + historical-status updates run as a single
   * batch so a partial portfolio sync can never be observed.
   */
  const statements: Array<{ sql: string; args: InArgs }> = [];

  for (const product of AUTHORITATIVE_PORTFOLIO) {
    statements.push({
      sql: upsertSql,
      args: {
        id: randomUUID(),
        future_url: null,
        notes: null,
        ...product,
      },
    });
  }

  for (const name of HISTORICAL_ASSETS) {
    statements.push({
      sql: markHistoricalSql,
      args: { name },
    });
  }

  statements.push({
    sql: upsertSql,
    args: {
      id: randomUUID(),
      name: "Innocent Marketplace",
      url: "https://innocent.co.ke",
      status: "active",
      asset_type: "hub",
      category: "ecosystem hub",
      description:
        "Central Innocent Labs marketplace and portfolio hub.",
      future_url: null,
      notes:
        "Infrastructure/hub record; excluded from autonomous product audit tasks.",
    },
  });

  await db.batch(statements, "write");
}

/**
 * Initializes/reconciles the manually supplied bootstrap portfolio.
 */
export async function seedProductsIfEmpty(): Promise<void> {
  await syncAuthoritativePortfolio();
}

/**
 * Returns every portfolio record, including hubs and historical assets.
 */
export async function listProducts(): Promise<Product[]> {
  const db = await getDb();

  const result = await db.execute(
    `SELECT * FROM products ORDER BY name ASC`
  );

  return result.rows as unknown as Product[];
}

/**
 * Returns only current product records with usable URLs.
 */
export async function listProductsWithUrl(): Promise<Product[]> {
  const products = await listProducts();

  return products.filter(
    (p) =>
      p.asset_type === "product" &&
      p.status !== "discontinued" &&
      !!p.url
  );
}

/**
 * Returns a single product by exact name.
 */
export async function getProductByName(
  name: string
): Promise<Product | null> {
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT * FROM products WHERE name = ?`,
    args: [name],
  });

  const product = result.rows[0] as unknown as Product | undefined;

  return product ?? null;
}

/**
 * Returns products explicitly eligible for autonomous work.
 */
export async function listAutonomousProducts(): Promise<Product[]> {
  return listProductsWithUrl();
}

/**
 * Returns products that have not yet received a website audit.
 */
export async function listUnauditedProducts(): Promise<Product[]> {
  const products = await listAutonomousProducts();

  return products.filter(
    (product) => !product.last_audited_at
  );
}

/**
 * Returns the most recent successful website-audit task result for a product.
 */
export async function getLatestWebsiteAuditResult(
  productName: string
): Promise<{
  task_id: string;
  task_status: string;
  completed_at: string | null;
  result_summary: string | null;
  result_data: Record<string, unknown> | null;
} | null> {
  const db = await getDb();

  const result = await db.execute(`
    SELECT
      id,
      status,
      completed_at,
      result_summary,
      result_json
    FROM agent_tasks
    WHERE task_type = 'website_audit'
      AND status IN ('COMPLETED', 'COMPLETED_WITH_ISSUES')
      AND result_json IS NOT NULL
    ORDER BY completed_at DESC, updated_at DESC
  `);

  const rows = result.rows as unknown as Array<{
    id: string;
    status: string;
    completed_at: string | null;
    result_summary: string | null;
    result_json: string;
  }>;

  for (const row of rows) {
    try {
      const parsed = JSON.parse(
        row.result_json
      ) as Record<string, unknown>;

      if (parsed.product_name === productName) {
        return {
          task_id: row.id,
          task_status: row.status,
          completed_at: row.completed_at,
          result_summary: row.result_summary,
          result_data: parsed,
        };
      }
    } catch {
      // Ignore malformed historical task results.
    }
  }

  return null;
}

/**
 * Normalizes a discovered product name.
 */
export function normalizePortfolioProductName(
  value: string
): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Validates an HTTP(S) URL.
 */
export function isValidPortfolioUrl(
  value: string
): boolean {
  try {
    const url = new URL(value.trim());

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

/**
 * Upserts a product discovered from the live Innocent Labs marketplace.
 *
 * IMPORTANT:
 *
 * This function deliberately updates ONLY portfolio identity fields.
 *
 * It does not overwrite:
 * - problem;
 * - audience;
 * - positioning;
 * - features;
 * - commercial model;
 * - pricing;
 * - CTA;
 * - evidence;
 * - unknowns;
 * - confidence;
 * - last_audited_at.
 *
 * This allows the live portfolio refresh to remain separate from deeper
 * product intelligence.
 */
export async function upsertDiscoveredPortfolioProduct(input: {
  name: string;
  url: string;
  category?: string;
  description?: string;
  status?: Product["status"];
  notes?: string | null;
}): Promise<Product> {
  const name = normalizePortfolioProductName(input.name);
  const url = input.url.trim();

  if (!name) {
    throw new Error(
      "Cannot persist a discovered portfolio product without a name."
    );
  }

  if (!isValidPortfolioUrl(url)) {
    throw new Error(
      `Cannot persist portfolio product "${name}" because its URL is not a valid HTTP(S) URL.`
    );
  }

  const db = await getDb();

  const existing = await getProductByName(name);

  if (existing) {
    await db.execute({
      sql: `
        UPDATE products
        SET
          url = @url,
          category = COALESCE(@category, category),
          description = COALESCE(@description, description),
          status = COALESCE(@status, status),
          notes = COALESCE(@notes, notes),
          updated_at = ${NOW_ISO_SQL}
        WHERE id = @id
      `,
      args: {
        id: existing.id,
        url,
        category:
          input.category?.trim() || null,
        description:
          input.description?.trim() || null,
        status:
          input.status ?? null,
        notes:
          input.notes?.trim() || null,
      },
    });
  } else {
    await db.execute({
      sql: `
        INSERT INTO products (
          id,
          name,
          url,
          status,
          asset_type,
          category,
          description,
          notes
        )
        VALUES (
          @id,
          @name,
          @url,
          @status,
          'product',
          @category,
          @description,
          @notes
        )
      `,
      args: {
        id: randomUUID(),
        name,
        url,
        status: input.status ?? "active",
        category:
          input.category?.trim() || "unknown",
        description:
          input.description?.trim() || null,
        notes:
          input.notes?.trim() || null,
      },
    });
  }

  const product = await getProductByName(name);

  if (!product) {
    throw new Error(
      `Portfolio product "${name}" was written but could not be retrieved afterward.`
    );
  }

  return product;
}
