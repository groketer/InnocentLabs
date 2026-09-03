#!/usr/bin/env node
/**
 * One-time data migration: local SQLite (data/app.db, the old
 * better-sqlite3 database) -> Postgres/Neon (DATABASE_URL).
 *
 * Run this ONCE, locally, after you've set DATABASE_URL to your real Neon
 * connection string (see .env.example). It's safe to re-run — every
 * insert is idempotent (ON CONFLICT (id) DO NOTHING keyed on each row's
 * original UUID), so a second run just confirms nothing new needs
 * copying rather than duplicating data.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/migrate-sqlite-to-postgres.cjs
 *   DATABASE_URL="postgresql://..." node scripts/migrate-sqlite-to-postgres.cjs --dry-run
 *
 * Optional:
 *   SQLITE_SOURCE_PATH=./data/app.db   (default shown)
 *
 * Requires better-sqlite3 to read the old file:
 *   npm install better-sqlite3 --no-save
 * (It's intentionally NOT a permanent dependency of the app anymore —
 * install it just for this one run, then it's fine to remove.)
 *
 * WHY PRODUCTS ARE HANDLED DIFFERENTLY FROM EVERYTHING ELSE:
 * The Postgres database already has its own 18 bootstrap products (from
 * syncAuthoritativePortfolio(), which runs automatically on first
 * connect). Your local SQLite file has its own copies of those same
 * products (matched by name) PLUS whatever extra products were
 * discovered since. Blindly copying by ID would create duplicates for
 * every bootstrap product. Instead, products are matched by name: if a
 * name already exists in Postgres, we keep ITS id and only backfill
 * empty intelligence fields (evidence, confidence, etc.) from your local
 * copy; only genuinely new product names get inserted with their
 * original id. Prospects' product_id references are remapped through
 * this same name-based match, since the id on the Postgres side may
 * differ from the id in your local file.
 */

const path = require("path");
const Database = require("better-sqlite3");
const { Pool, neonConfig } = require("@neondatabase/serverless");
const ws = require("ws");

neonConfig.webSocketConstructor = ws;

const DRY_RUN = process.argv.includes("--dry-run");

const SQLITE_PATH =
  process.env.SQLITE_SOURCE_PATH ||
  path.join(process.cwd(), "data", "app.db");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Point it at your Neon/Postgres database first."
    );
    process.exit(1);
  }

  console.log(`Source (SQLite): ${SQLITE_PATH}`);
  console.log(`Target (Postgres): ${maskConnectionString(process.env.DATABASE_URL)}`);
  console.log(DRY_RUN ? "Mode: DRY RUN (no writes)\n" : "Mode: LIVE (will write)\n");

  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await ensureSchema(pool);

    const productIdMap = await migrateProducts(sqlite, pool);
    await migrateAgentTasks(sqlite, pool);
    await migrateActivityEvents(sqlite, pool);
    await migrateChatMessages(sqlite, pool);
    await migrateProspects(sqlite, pool, productIdMap);

    console.log("\nDone.");
  } finally {
    sqlite.close();
    await pool.end();
  }
}

function maskConnectionString(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "(unparseable connection string)";
  }
}

/**
 * Minimal, idempotent schema bootstrap — duplicated (deliberately, in
 * miniature) from src/lib/db.ts's runMigrations() so this script works
 * standalone even before you've deployed/run the app once against the
 * new database. Safe to run against an already-migrated database: every
 * statement is IF NOT EXISTS.
 */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT,
      status TEXT NOT NULL DEFAULT 'active', asset_type TEXT NOT NULL DEFAULT 'product',
      category TEXT NOT NULL DEFAULT 'unknown', description TEXT, future_url TEXT, notes TEXT,
      problem TEXT, audience TEXT, positioning TEXT, features TEXT, commercial_model TEXT,
      pricing TEXT, cta TEXT, evidence TEXT, unknowns TEXT, confidence REAL, last_audited_at TEXT,
      created_at TEXT NOT NULL DEFAULT now()::text, updated_at TEXT NOT NULL DEFAULT now()::text
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, parent_task_id TEXT REFERENCES agent_tasks(id),
      title TEXT NOT NULL, description TEXT, task_type TEXT NOT NULL, status TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL DEFAULT now()::text,
      started_at TEXT, updated_at TEXT NOT NULL DEFAULT now()::text, completed_at TEXT,
      paused_at TEXT, last_activity_at TEXT, next_retry_at TEXT, progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER, progress_label TEXT, current_step TEXT, current_subtask TEXT,
      worker_id TEXT, execution_id TEXT, heartbeat_at TEXT, last_attempt_at TEXT,
      result_summary TEXT, result_json TEXT, result_reference TEXT, error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
      conversation_id TEXT, requires_user_input INTEGER NOT NULL DEFAULT 0,
      input_reason TEXT, created_by TEXT NOT NULL DEFAULT 'agent'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT REFERENCES agent_tasks(id),
      event_type TEXT NOT NULL, message TEXT NOT NULL, metadata TEXT,
      severity TEXT NOT NULL DEFAULT 'info', created_at TEXT NOT NULL DEFAULT now()::text
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT now()::text
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_task_id TEXT REFERENCES agent_tasks(id),
      name TEXT NOT NULL, organization TEXT, role TEXT, email TEXT, prospect_type TEXT NOT NULL,
      qualification_status TEXT NOT NULL DEFAULT 'candidate', website TEXT, public_profile_url TEXT,
      product_id TEXT REFERENCES products(id), fit_reason TEXT, opportunity_signal TEXT,
      evidence TEXT, confidence REAL, unknowns TEXT,
      created_at TEXT NOT NULL DEFAULT now()::text, updated_at TEXT NOT NULL DEFAULT now()::text
    )
  `);
}

async function migrateProducts(sqlite, pool) {
  const rows = sqlite.prepare(`SELECT * FROM products`).all();
  const idMap = new Map(); // source id -> target id

  let inserted = 0;
  let matched = 0;
  let backfilled = 0;

  for (const row of rows) {
    const existing = await pool.query(
      `SELECT id FROM products WHERE name = $1`,
      [row.name]
    );

    if (existing.rows.length > 0) {
      const targetId = existing.rows[0].id;
      idMap.set(row.id, targetId);
      matched++;

      if (!DRY_RUN) {
        // Only fill fields that are currently empty on the target —
        // never clobber intelligence the target may already have.
        const result = await pool.query(
          `
            UPDATE products SET
              description = COALESCE(description, $2),
              problem = COALESCE(problem, $3),
              audience = COALESCE(audience, $4),
              positioning = COALESCE(positioning, $5),
              features = COALESCE(features, $6),
              commercial_model = COALESCE(commercial_model, $7),
              pricing = COALESCE(pricing, $8),
              cta = COALESCE(cta, $9),
              evidence = COALESCE(evidence, $10),
              unknowns = COALESCE(unknowns, $11),
              confidence = COALESCE(confidence, $12),
              last_audited_at = COALESCE(last_audited_at, $13)
            WHERE id = $1
          `,
          [
            targetId,
            row.description,
            row.problem,
            row.audience,
            row.positioning,
            row.features,
            row.commercial_model,
            row.pricing,
            row.cta,
            row.evidence,
            row.unknowns,
            row.confidence,
            row.last_audited_at,
          ]
        );
        if (result.rowCount > 0) backfilled++;
      }
    } else {
      idMap.set(row.id, row.id);
      inserted++;

      if (!DRY_RUN) {
        await pool.query(
          `
            INSERT INTO products (
              id, name, url, status, asset_type, category, description, future_url, notes,
              problem, audience, positioning, features, commercial_model, pricing, cta,
              evidence, unknowns, confidence, last_audited_at, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            ON CONFLICT (id) DO NOTHING
          `,
          [
            row.id, row.name, row.url, row.status, row.asset_type, row.category,
            row.description, row.future_url, row.notes, row.problem, row.audience,
            row.positioning, row.features, row.commercial_model, row.pricing, row.cta,
            row.evidence, row.unknowns, row.confidence, row.last_audited_at,
            row.created_at, row.updated_at,
          ]
        );
      }
    }
  }

  console.log(
    `products: ${rows.length} read, ${matched} matched by name (${backfilled} backfilled), ${inserted} new`
  );
  return idMap;
}

async function migrateAgentTasks(sqlite, pool) {
  const rows = sqlite.prepare(`SELECT * FROM agent_tasks`).all();
  let insertedCount = 0;

  // Pass 1: insert every row with parent_task_id NULL, so the
  // self-referencing FK never fails regardless of row order.
  for (const row of rows) {
    if (DRY_RUN) continue;

    const result = await pool.query(
      `
        INSERT INTO agent_tasks (
          id, user_id, parent_task_id, title, description, task_type, status, priority,
          created_at, started_at, updated_at, completed_at, paused_at, last_activity_at,
          next_retry_at, progress_current, progress_total, progress_label, current_step,
          current_subtask, worker_id, execution_id, heartbeat_at, last_attempt_at,
          result_summary, result_json, result_reference, error_message, retry_count,
          max_retries, conversation_id, requires_user_input, input_reason, created_by
        ) VALUES (
          $1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          NULL,NULL,NULL,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        row.id, row.user_id, row.title, row.description, row.task_type, row.status,
        row.priority, row.created_at, row.started_at, row.updated_at, row.completed_at,
        row.paused_at, row.last_activity_at, row.next_retry_at, row.progress_current,
        row.progress_total, row.progress_label, row.current_step, row.current_subtask,
        row.last_attempt_at, row.result_summary, row.result_json, row.result_reference,
        row.error_message, row.retry_count, row.max_retries, row.conversation_id,
        row.requires_user_input, row.input_reason, row.created_by,
      ]
    );
    if (result.rowCount > 0) insertedCount++;
  }

  // Pass 2: backfill parent_task_id now that every row exists.
  if (!DRY_RUN) {
    for (const row of rows) {
      if (!row.parent_task_id) continue;
      await pool.query(
        `UPDATE agent_tasks SET parent_task_id = $2 WHERE id = $1 AND parent_task_id IS NULL`,
        [row.id, row.parent_task_id]
      );
    }
  }

  console.log(`agent_tasks: ${rows.length} read, ${DRY_RUN ? "(dry run)" : `${insertedCount} new`}`);
}

async function migrateActivityEvents(sqlite, pool) {
  const rows = sqlite.prepare(`SELECT * FROM activity_events`).all();
  let insertedCount = 0;

  for (const row of rows) {
    if (DRY_RUN) continue;

    const result = await pool.query(
      `
        INSERT INTO activity_events (id, user_id, task_id, event_type, message, metadata, severity, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING
      `,
      [row.id, row.user_id, row.task_id, row.event_type, row.message, row.metadata, row.severity, row.created_at]
    );
    if (result.rowCount > 0) insertedCount++;
  }

  console.log(`activity_events: ${rows.length} read, ${DRY_RUN ? "(dry run)" : `${insertedCount} new`}`);
}

async function migrateChatMessages(sqlite, pool) {
  const rows = sqlite.prepare(`SELECT * FROM chat_messages`).all();
  let insertedCount = 0;

  for (const row of rows) {
    if (DRY_RUN) continue;

    const result = await pool.query(
      `
        INSERT INTO chat_messages (id, conversation_id, user_id, role, content, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING
      `,
      [row.id, row.conversation_id, row.user_id, row.role, row.content, row.created_at]
    );
    if (result.rowCount > 0) insertedCount++;
  }

  console.log(`chat_messages: ${rows.length} read, ${DRY_RUN ? "(dry run)" : `${insertedCount} new`}`);
}

async function migrateProspects(sqlite, pool, productIdMap) {
  const rows = sqlite.prepare(`SELECT * FROM prospects`).all();
  let insertedCount = 0;
  let unmappedProduct = 0;

  for (const row of rows) {
    const remappedProductId = row.product_id
      ? productIdMap.get(row.product_id) ?? null
      : null;

    if (row.product_id && !remappedProductId) unmappedProduct++;

    if (DRY_RUN) continue;

    const result = await pool.query(
      `
        INSERT INTO prospects (
          id, user_id, source_task_id, name, organization, role, email, prospect_type,
          qualification_status, website, public_profile_url, product_id, fit_reason,
          opportunity_signal, evidence, confidence, unknowns, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        row.id, row.user_id, row.source_task_id, row.name, row.organization, row.role,
        row.email, row.prospect_type, row.qualification_status, row.website,
        row.public_profile_url, remappedProductId, row.fit_reason, row.opportunity_signal,
        row.evidence, row.confidence, row.unknowns, row.created_at, row.updated_at,
      ]
    );
    if (result.rowCount > 0) insertedCount++;
  }

  console.log(
    `prospects: ${rows.length} read, ${DRY_RUN ? "(dry run)" : `${insertedCount} new`}` +
      (unmappedProduct > 0 ? ` (${unmappedProduct} had a product reference that couldn't be remapped — left NULL)` : "")
  );
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
