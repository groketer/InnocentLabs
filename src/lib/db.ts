/**
 * Database connection + schema.
 *
 * Milestone 3A introduced the first real persistent database for
 * Innocent Intelligence. Milestone 3B extends that schema with:
 *
 * - worker/execution ownership;
 * - heartbeat and retry metadata;
 * - structured task results;
 * - richer portfolio intelligence;
 * - activity severity;
 * - persistent chat history.
 *
 * Milestone 3D adds:
 *
 * - persistent prospect intelligence;
 * - user ownership and task lineage for prospect records;
 * - optional linkage between prospects and portfolio products;
 * - first-class prospect contact email.
 *
 * SQLite remains the local persistence layer for the current single-process
 * development/runtime environment.
 *
 * IMPORTANT:
 * Existing databases must remain usable. Migrations below are therefore
 * additive and non-destructive.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

declare global {
  // eslint-disable-next-line no-var
  var __innocentIntelligenceDb: Database.Database | undefined;
}

function createConnection(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);

  /*
   * WAL improves concurrency between reads and writes while keeping SQLite
   * appropriate for the current single-process architecture.
   */
  db.pragma("journal_mode = WAL");

  /*
   * Foreign-key enforcement must be enabled on every connection because
   * SQLite does not enable it by default.
   */
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  /*
   * The CREATE TABLE definitions represent the current schema.
   *
   * Existing Milestone 3A databases may have older versions of these tables.
   * The additive migrations below bring those databases forward without
   * destroying existing data.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      url                 TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      asset_type          TEXT NOT NULL DEFAULT 'product',
      category            TEXT NOT NULL DEFAULT 'unknown',
      description         TEXT,
      future_url          TEXT,
      notes               TEXT,
      problem             TEXT,
      audience            TEXT,
      positioning         TEXT,
      features            TEXT,
      commercial_model    TEXT,
      pricing             TEXT,
      cta                 TEXT,
      evidence            TEXT,
      unknowns            TEXT,
      confidence          REAL,
      last_audited_at     TEXT,
      created_at          TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      updated_at          TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    );

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id                   TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL,
      parent_task_id       TEXT REFERENCES agent_tasks(id),
      title                TEXT NOT NULL,
      description          TEXT,
      task_type            TEXT NOT NULL,
      status               TEXT NOT NULL,
      priority             TEXT NOT NULL DEFAULT 'normal',
      created_at           TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      started_at           TEXT,
      updated_at           TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ),
      completed_at         TEXT,
      paused_at            TEXT,
      last_activity_at     TEXT,
      next_retry_at        TEXT,
      progress_current     INTEGER NOT NULL DEFAULT 0,
      progress_total       INTEGER,
      progress_label       TEXT,
      current_step         TEXT,
      current_subtask      TEXT,
      worker_id            TEXT,
      execution_id         TEXT,
      heartbeat_at         TEXT,
      last_attempt_at      TEXT,
      result_summary       TEXT,
      result_json          TEXT,
      result_reference     TEXT,
      error_message        TEXT,
      retry_count          INTEGER NOT NULL DEFAULT 0,
      max_retries          INTEGER NOT NULL DEFAULT 3,
      conversation_id      TEXT,
      requires_user_input  INTEGER NOT NULL DEFAULT 0,
      input_reason         TEXT,
      created_by           TEXT NOT NULL DEFAULT 'agent'
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_user
      ON agent_tasks(user_id);

    CREATE INDEX IF NOT EXISTS idx_tasks_parent
      ON agent_tasks(parent_task_id);

    CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON agent_tasks(status);

    CREATE INDEX IF NOT EXISTS idx_tasks_claim
      ON agent_tasks(parent_task_id, status, next_retry_at);

    CREATE TABLE IF NOT EXISTS activity_events (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      task_id     TEXT REFERENCES agent_tasks(id),
      event_type  TEXT NOT NULL,
      message     TEXT NOT NULL,
      metadata    TEXT,
      severity    TEXT NOT NULL DEFAULT 'info',
      created_at  TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    );

    CREATE INDEX IF NOT EXISTS idx_activity_user
      ON activity_events(user_id);

    CREATE INDEX IF NOT EXISTS idx_activity_task
      ON activity_events(task_id);

    CREATE INDEX IF NOT EXISTS idx_activity_created
      ON activity_events(created_at);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      )
    );

    CREATE INDEX IF NOT EXISTS idx_chat_conversation
      ON chat_messages(user_id, conversation_id, created_at);

    /*
     * ---------------------------------------------------------------------
     * Milestone 3D — Prospect intelligence.
     * ---------------------------------------------------------------------
     *
     * A prospect is an evidence-backed potentially relevant entity.
     *
     * This is intentionally NOT a CRM table. It does not contain outreach
     * state, contact history, or communication records.
     *
     * Email is a first-class contactable asset.
     *
     * IMPORTANT:
     * Prospect indexes are created later, after additive migrations have
     * ensured that all columns exist. This keeps existing databases with
     * older prospects schemas upgradeable.
     */
 CREATE TABLE IF NOT EXISTS prospects (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  source_task_id        TEXT REFERENCES agent_tasks(id),
  name                  TEXT NOT NULL,
  organization          TEXT,
  role                  TEXT,
  email                 TEXT,
  prospect_type         TEXT NOT NULL,
  qualification_status  TEXT NOT NULL DEFAULT 'candidate',
  website               TEXT,
  public_profile_url    TEXT,
  product_id            TEXT REFERENCES products(id),
  fit_reason            TEXT,
  opportunity_signal    TEXT,
  evidence              TEXT,
  confidence            REAL,
  unknowns              TEXT,
  created_at            TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  updated_at            TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
);
  `);

  /*
   * -----------------------------------------------------------------------
   * Additive migrations for existing agent_tasks tables.
   * -----------------------------------------------------------------------
   */
  const taskColumns = db
    .prepare(`PRAGMA table_info(agent_tasks)`)
    .all() as Array<{ name: string }>;

  const taskAdditions: Array<[string, string]> = [
    ["worker_id", "TEXT"],
    ["execution_id", "TEXT"],
    ["heartbeat_at", "TEXT"],
    ["last_attempt_at", "TEXT"],
    ["result_json", "TEXT"],
    ["input_reason", "TEXT"],
  ];

  for (const [name, definition] of taskAdditions) {
    if (!taskColumns.some((column) => column.name === name)) {
      db.exec(
        `ALTER TABLE agent_tasks ADD COLUMN ${name} ${definition}`
      );
    }
  }

  /*
   * -----------------------------------------------------------------------
   * Additive migrations for products.
   * -----------------------------------------------------------------------
   */
  const productColumns = db
    .prepare(`PRAGMA table_info(products)`)
    .all() as Array<{ name: string }>;

  const productAdditions: Array<[string, string]> = [
    ["problem", "TEXT"],
    ["audience", "TEXT"],
    ["positioning", "TEXT"],
    ["features", "TEXT"],
    ["commercial_model", "TEXT"],
    ["pricing", "TEXT"],
    ["cta", "TEXT"],
    ["evidence", "TEXT"],
    ["unknowns", "TEXT"],
    ["confidence", "REAL"],
    ["last_audited_at", "TEXT"],
  ];

  for (const [name, definition] of productAdditions) {
    if (!productColumns.some((column) => column.name === name)) {
      db.exec(
        `ALTER TABLE products ADD COLUMN ${name} ${definition}`
      );
    }
  }

  /*
   * -----------------------------------------------------------------------
   * Additive migration for activity severity.
   * -----------------------------------------------------------------------
   */
  const activityColumns = db
    .prepare(`PRAGMA table_info(activity_events)`)
    .all() as Array<{ name: string }>;

  if (!activityColumns.some((column) => column.name === "severity")) {
    db.exec(
      `ALTER TABLE activity_events
       ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'`
    );
  }

  /*
   * -----------------------------------------------------------------------
   * Additive migration for prospects.
   * -----------------------------------------------------------------------
   *
   * The original 3D schema may already exist without ownership, task
   * lineage, product linkage, or contact email. Add those columns without
   * destroying existing prospect records.
   *
   * Existing records receive NULL for newly introduced fields.
   */
  const prospectColumns = db
    .prepare(`PRAGMA table_info(prospects)`)
    .all() as Array<{ name: string }>;

const prospectAdditions: Array<[string, string]> = [
  ["user_id", "TEXT"],
  ["source_task_id", "TEXT"],
  ["email", "TEXT"],
  ["product_id", "TEXT"],
];

  for (const [name, definition] of prospectAdditions) {
    if (!prospectColumns.some((column) => column.name === name)) {
      db.exec(
        `ALTER TABLE prospects ADD COLUMN ${name} ${definition}`
      );
    }
  }

  /*
   * -----------------------------------------------------------------------
   * Prospect indexes.
   * -----------------------------------------------------------------------
   *
   * These must be created AFTER the additive prospect-column migrations.
   * This is critical for existing databases whose prospects table predates
   * user_id, source_task_id, product_id, or email.
   */
  db.exec(`
CREATE INDEX IF NOT EXISTS idx_prospects_user
  ON prospects(user_id);

CREATE INDEX IF NOT EXISTS idx_prospects_qualification
  ON prospects(qualification_status);

CREATE INDEX IF NOT EXISTS idx_prospects_type
  ON prospects(prospect_type);

CREATE INDEX IF NOT EXISTS idx_prospects_product
  ON prospects(product_id);

CREATE INDEX IF NOT EXISTS idx_prospects_email
  ON prospects(email);

CREATE INDEX IF NOT EXISTS idx_prospects_created
  ON prospects(created_at);
  `);
}

/**
 * Returns a singleton database connection.
 *
 * Keeping the connection on globalThis prevents Next.js development
 * hot-reload from repeatedly opening new SQLite connections.
 */
export function getDb(): Database.Database {
  if (!global.__innocentIntelligenceDb) {
    global.__innocentIntelligenceDb = createConnection();
  }

  return global.__innocentIntelligenceDb;
}