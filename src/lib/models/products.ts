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
    name: "Innocent Intelligence",
    url: "https://ilabs.innocent.co.ke",
    asset_type: "product",
    category: "AI business development platform",
    description:
      "An autonomous AI system that runs a business's outbound growth work continuously — researching the market, finding real prospects, writing and sending personalized outreach, and handling replies — sold as a done-for-you service to businesses across Kenya and Eastern Africa. Innocent Labs' own outreach for its product portfolio runs on this exact system, which serves as a live, working demonstration rather than a claim.",
    status: "active",
    notes:
      "Geographic priority: Kenya first, then the rest of Eastern Africa. Pricing differs by region — see supplementary_knowledge once set via the Products page, since it's a structured field better edited there than baked into this static portfolio entry.",
  },
  {
    name: "Innocent.co.ke Marketplace",
    url: "https://innocent.co.ke",
    asset_type: "product",
    category: "marketplace platform",
    description:
      "An open marketplace where anyone can list and sell their own products — a business opportunity in its own right (attracting sellers to list and buyers to browse), separate from the individual products listed on it.",
    status: "active",
    notes:
      "Deliberately a SEPARATE record from the 'Innocent Marketplace' hub entry below, which exists only for internal organizational/exclusion purposes (prospecting never targets what's listed in that hub). This record is the marketplace platform itself as something to actively market and grow — added at Innocent's explicit request.",
  },
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

  {
    name: "Patterns of Opportunity: Seeing What Others Overlook",
    url: "https://books.prfed.com/patterns/",
    asset_type: "product",
    category: "book / business strategy",
    description:
      "A book by Innocent Mwangi. Available on Amazon in Kindle (https://www.amazon.com/dp/B0HGVNBNBX) and paperback (https://www.amazon.com/dp/B0HH8MP9MB) editions.",
    status: "active",
    notes:
      "IMPORTANT: always use the full title \"Patterns of Opportunity: Seeing What Others Overlook\" when referring to this book, never the shortened \"Patterns of Opportunity\" — a different, more widely known book (by Hunter) shares that shortened title, and abbreviating risks promoting the wrong book.",
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
      p.approval_status === "approved" &&
      !!p.url
  );
}

/**
 * Returns a single product by exact name.
 */
/**
 * MILESTONE 4Y — a real, confirmed bug this fixes: this previously did an
 * exact string match only. When someone referred to "Patterns of
 * Opportunity" (the natural short form) while the stored name is the
 * full title "Patterns of Opportunity: Seeing What Others Overlook",
 * this returned null — and the agent then confidently told the user no
 * such product existed at all, which was simply wrong, not a genuine
 * data gap. Tries an exact match first (fast, and correct when the name
 * is already exact), then falls back to a case-insensitive partial
 * match in both directions — the stored name contains the query, or the
 * query contains the stored name — so a short form, a slightly
 * different case, or a trailing subtitle all still resolve correctly.
 */
export async function getProductByName(
  name: string
): Promise<Product | null> {
  const db = await getDb();
  const trimmed = name.trim();

  const exact = await db.execute({
    sql: `SELECT * FROM products WHERE name = ?`,
    args: [trimmed],
  });
  const exactMatch = exact.rows[0] as unknown as Product | undefined;
  if (exactMatch) return exactMatch;

  const fuzzy = await db.execute({
    sql: `
      SELECT * FROM products
      WHERE name ILIKE '%' || ? || '%' OR ? ILIKE '%' || name || '%'
      ORDER BY length(name) ASC
      LIMIT 1
    `,
    args: [trimmed, trimmed],
  });
  const fuzzyMatch = fuzzy.rows[0] as unknown as Product | undefined;

  return fuzzyMatch ?? null;
}

export async function getProductById(
  id: string
): Promise<Product | null> {
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT * FROM products WHERE id = ?`,
    args: [id],
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
 * MILESTONE 3I — autonomous auditing.
 *
 * Returns the single product most in need of a fresh audit: never-audited
 * products first (oldest-created among those, for determinism), then
 * whichever audited product has gone longest without a re-audit. Used by
 * the autonomous audit scheduler to work through the whole portfolio
 * gradually, one product per day, rather than either leaving products
 * with thin/no intelligence indefinitely or re-auditing everything at
 * once (wasteful — most products' intelligence doesn't change day to
 * day).
 *
 * This is what actually gives the prospecting agent something real to
 * work with (problem/audience/positioning/features/pricing/cta) instead
 * of just a bare name and URL.
 */
export async function getProductMostNeedingAudit(): Promise<Product | null> {
  const products = await listAutonomousProducts();

  if (products.length === 0) {
    return null;
  }

  const sorted = [...products].sort((a, b) => {
    const aAudited = Boolean(a.last_audited_at);
    const bAudited = Boolean(b.last_audited_at);

    if (aAudited !== bAudited) {
      // Never-audited products always come before audited ones.
      return aAudited ? 1 : -1;
    }

    if (!aAudited && !bAudited) {
      // Both never audited — oldest-created first, for determinism.
      return (
        new Date(a.created_at).getTime() -
        new Date(b.created_at).getTime()
      );
    }

    // Both audited — the one audited longest ago goes first.
    return (
      new Date(a.last_audited_at as string).getTime() -
      new Date(b.last_audited_at as string).getTime()
    );
  });

  return sorted[0];
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
          notes,
          approval_status
        )
        VALUES (
          @id,
          @name,
          @url,
          @status,
          'product',
          @category,
          @description,
          @notes,
          'pending'
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

/**
 * Updates a product's free-text notes only.
 *
 * Deliberately narrow: everything else on a product (description, problem,
 * audience, positioning, evidence, confidence, etc.) is derived from
 * website audits or the live marketplace refresh, not something a person
 * should overwrite by hand from the Products view. Notes are the one field
 * meant for a human's own commentary/strategy thinking alongside the
 * agent-derived intelligence.
 */
export async function updateProductNotes(
  id: string,
  notes: string
): Promise<Product> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      UPDATE products
      SET notes = @notes, updated_at = ${NOW_ISO_SQL}
      WHERE id = @id
    `,
    args: { id, notes },
  });

  if (result.rowsAffected === 0) {
    throw new Error("Product not found.");
  }

  const result2 = await db.execute({
    sql: `SELECT * FROM products WHERE id = ?`,
    args: [id],
  });

  const product = result2.rows[0] as unknown as Product | undefined;

  if (!product) {
    throw new Error("Product was updated but could not be retrieved afterward.");
  }

  return product;
}

/**
 * MILESTONE 3T — per-product campaign focus.
 *
 * Toggles whether outreach SENDING should currently include this
 * product. Prospecting is deliberately unaffected — it keeps running for
 * every product regardless, so the pipeline stays full and ready to go
 * the moment focus shifts to a different product, rather than needing to
 * "catch up" from a cold start.
 */
export async function updateProductCampaignPaused(
  id: string,
  paused: boolean
): Promise<Product> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      UPDATE products
      SET campaign_paused = @paused, updated_at = ${NOW_ISO_SQL}
      WHERE id = @id
    `,
    args: { id, paused },
  });

  if (result.rowsAffected === 0) {
    throw new Error("Product not found.");
  }

  const result2 = await db.execute({
    sql: `SELECT * FROM products WHERE id = ?`,
    args: [id],
  });

  const product = result2.rows[0] as unknown as Product | undefined;

  if (!product) {
    throw new Error("Product was updated but could not be retrieved afterward.");
  }

  return product;
}


/**
 * MILESTONE 3O — geographic targeting per product.
 *
 * A free-text instruction (e.g. "Kenya first, then Eastern Africa as a
 * second priority") that the prospecting agent treats as a hard
 * directive for this specific product — see buildProductContext() in
 * prospecting.ts, which includes this verbatim in the agent's brief when
 * it's set.
 */
/**
 * MILESTONE 3U — product knowledge base.
 *
 * Free-text supplementary knowledge — gated info, internal context, or
 * anything else not published anywhere the agent could discover it on
 * its own. Short enough to be included directly in a composer's prompt
 * every time, unlike uploaded documents which are searched instead.
 */
export async function updateProductSupplementaryKnowledge(
  id: string,
  knowledge: string
): Promise<Product> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      UPDATE products
      SET supplementary_knowledge = @knowledge, updated_at = ${NOW_ISO_SQL}
      WHERE id = @id
    `,
    args: { id, knowledge: knowledge || null },
  });

  if (result.rowsAffected === 0) {
    throw new Error("Product not found.");
  }

  const result2 = await db.execute({
    sql: `SELECT * FROM products WHERE id = ?`,
    args: [id],
  });

  const product = result2.rows[0] as unknown as Product | undefined;
  if (!product) {
    throw new Error("Product was updated but could not be retrieved afterward.");
  }
  return product;
}

export async function updateProductGeographicFocus(
  id: string,
  geographicFocus: string
): Promise<Product> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      UPDATE products
      SET geographic_focus = @geographic_focus, updated_at = ${NOW_ISO_SQL}
      WHERE id = @id
    `,
    args: { id, geographic_focus: geographicFocus || null },
  });

  if (result.rowsAffected === 0) {
    throw new Error("Product not found.");
  }

  const result2 = await db.execute({
    sql: `SELECT * FROM products WHERE id = ?`,
    args: [id],
  });

  const product = result2.rows[0] as unknown as Product | undefined;

  if (!product) {
    throw new Error("Product was updated but could not be retrieved afterward.");
  }

  return product;
}

/**
 * MILESTONE 3V — approval gating.
 *
 * Approves a pending product (discovered from the marketplace, not yet
 * confirmed as Innocent's own) — makes it eligible for prospecting and
 * campaigns going forward. The reject path is just deleteProduct(); a
 * rejected listing isn't Innocent's product, so there's nothing to keep
 * a record of.
 */
export async function approveProduct(id: string): Promise<Product> {
  const db = await getDb();

  const result = await db.execute({
    sql: `
      UPDATE products
      SET approval_status = 'approved', updated_at = ${NOW_ISO_SQL}
      WHERE id = @id
    `,
    args: { id },
  });

  if (result.rowsAffected === 0) {
    throw new Error("Product not found.");
  }

  const result2 = await db.execute({
    sql: `SELECT * FROM products WHERE id = ?`,
    args: [id],
  });

  const product = result2.rows[0] as unknown as Product | undefined;
  if (!product) {
    throw new Error("Product was updated but could not be retrieved afterward.");
  }
  return product;
}

/**
 * MILESTONE 3V — manual product management.
 *
 * Deletes a product entirely — e.g. removing an accidental duplicate, or
 * rejecting a marketplace listing that turned out not to be Innocent's
 * own. Prospects that reference this product are NOT deleted — their
 * product_id is set to null so the historical record (evidence, past
 * outreach, replies) is preserved even though the product itself is
 * gone, rather than silently destroying real business data as a side
 * effect of cleaning up a product record. Uploaded documents DO cascade
 * (via the foreign key) since they only exist to serve this product.
 */
export async function deleteProduct(id: string): Promise<void> {
  const db = await getDb();

  await db.execute({
    sql: `UPDATE prospects SET product_id = NULL WHERE product_id = ?`,
    args: [id],
  });

  const result = await db.execute({
    sql: `DELETE FROM products WHERE id = ?`,
    args: [id],
  });

  if (result.rowsAffected === 0) {
    throw new Error("Product not found.");
  }
}

/**
 * MILESTONE 3V — manual product management.
 *
 * Creates a product directly, bypassing marketplace discovery entirely —
 * a deliberate failsafe for when innocent.co.ke itself has a problem, or
 * for a product that should never go through the marketplace-scraping
 * path in the first place. Manually created products are approved
 * immediately: a human directly creating a record IS the approval: the
 * pending-approval gate exists specifically to make automated marketplace
 * scraping less trusted than that, not to add friction to explicit intent.
 */
export async function createManualProduct(input: {
  name: string;
  url: string;
  category?: string;
  description?: string;
}): Promise<Product> {
  const name = input.name.trim();
  const url = input.url.trim();

  if (!name) {
    throw new Error("A product name is required.");
  }
  if (!isValidPortfolioUrl(url)) {
    throw new Error("A valid http(s) URL is required.");
  }

  const existing = await getProductByName(name);
  if (existing) {
    throw new Error(`A product named "${name}" already exists.`);
  }

  const db = await getDb();
  const id = randomUUID();

  await db.execute({
    sql: `
      INSERT INTO products (
        id, name, url, status, asset_type, category, description, approval_status
      )
      VALUES (
        @id, @name, @url, 'active', 'product', @category, @description, 'approved'
      )
    `,
    args: {
      id,
      name,
      url,
      category: input.category?.trim() || "unknown",
      description: input.description?.trim() || null,
    },
  });

  const product = await getProductByName(name);
  if (!product) {
    throw new Error(`Product "${name}" was created but could not be retrieved afterward.`);
  }
  return product;
}
