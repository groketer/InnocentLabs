/**
 * Database connection + schema.
 *
 * MILESTONE 3E — VERCEL POSTGRES / NEON:
 *
 * This started on `better-sqlite3` (local file only), briefly moved to
 * `@libsql/client`/Turso (chosen for minimal SQL-dialect drift), then to
 * Postgres via `@neondatabase/serverless`'s WebSocket-based `Pool` — and
 * THAT then turned out to be the wrong choice for classic (non-Fluid)
 * Vercel serverless functions: a `Pool` holds one persistent WebSocket
 * connection, cached here across invocations for reuse, but Vercel freezes
 * a function's execution between requests and doesn't guarantee the
 * WebSocket survives that freeze cleanly. In production this surfaced as
 * "Client has encountered a connection error and is not queryable",
 * ECONNRESET, and — most confusingly — a `TypeError: t.mask is not a
 * function` crash from a stale `ws` keepalive timer firing against an
 * already-torn-down socket after a freeze/thaw cycle.
 *
 * The fix: use Neon's HTTP query mode instead (`neon()`/`sql.query()`),
 * which is a plain `fetch()` per query with no persistent connection and
 * therefore nothing that can go stale between invocations — this is also
 * what Neon's own docs recommend for serverless functions without Vercel's
 * newer Fluid compute. This removed the `ws` dependency entirely.
 *
 * WHY THE MODEL/EXECUTOR FILES DIDN'T NEED TO CHANGE AGAIN (SEE BELOW):
 * Every model file already calls `db.execute({ sql, args })` using EITHER
 * `?` positional placeholders with an array, OR `@name` named placeholders
 * with an object — that's the libSQL/better-sqlite3 calling convention.
 * Rather than rewriting ~15 already-converted files a second time to
 * Postgres's `$1, $2, ...` positional style, this module implements a
 * small translation layer (toPositional() below) so the exact same
 * `{ sql, args }` call sites work unchanged against Postgres. This is the
 * one deliberate abstraction in an otherwise plain, un-clever data layer —
 * it exists specifically to avoid a second full rewrite of the model layer.
 * It also meant swapping the WebSocket Pool for the HTTP driver above only
 * required changing this one file, not every caller.
 *
 * Everything else (schema, migrations) IS Postgres-specific SQL, because
 * PRAGMA table_info(), strftime(), and SQLite's type affinity don't exist
 * in Postgres. Those differences are contained entirely to this file and
 * to ensureColumn()/syncAuthoritativePortfolio() in
 * src/lib/models/products.ts (the only other file with raw schema-adjacent
 * SQL — see the comments there).
 */

import { neon } from "@neondatabase/serverless";

export type InArgs = unknown[] | Record<string, unknown>;

export interface QueryResult<T = unknown> {
  rows: T[];
  rowsAffected: number;
}

export interface Db {
  execute<T = unknown>(input: {
    sql: string;
    args?: InArgs;
  }): Promise<QueryResult<T>>;
  execute<T = unknown>(sql: string): Promise<QueryResult<T>>;
  batch(
    statements: Array<{ sql: string; args?: InArgs }>,
    mode?: "write" | "read"
  ): Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __innocentIntelligenceDb: Promise<Db> | undefined;
}

/**
 * Converts a query written with `?` (array args) or `@name` (named object
 * args) placeholders into Postgres's positional `$1, $2, ...` syntax.
 *
 * This is what lets every model/executor file keep using the exact same
 * `db.execute({ sql, args })` call sites written for libSQL — see the
 * module doc comment above for why this exists.
 */
function toPositional(
  sqlText: string,
  args?: InArgs
): { text: string; values: unknown[] } {
  if (!args) {
    return { text: sqlText, values: [] };
  }

  if (Array.isArray(args)) {
    let index = 0;
    const text = sqlText.replace(/\?/g, () => `$${++index}`);
    return { text, values: args.map((v) => (v === undefined ? null : v)) };
  }

  const nameOrder: string[] = [];
  const text = sqlText.replace(
    /@([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, name: string) => {
      let idx = nameOrder.indexOf(name);
      if (idx === -1) {
        nameOrder.push(name);
        idx = nameOrder.length - 1;
      }
      return `$${idx + 1}`;
    }
  );

  const argsRecord = args as Record<string, unknown>;

  const values = nameOrder.map((name) => {
    if (!(name in argsRecord)) {
      throw new Error(
        `Missing parameter "${name}" for query: ${sqlText}`
      );
    }
    const value = argsRecord[name];
    return value === undefined ? null : value;
  });

  return { text, values };
}

function resolveConnectionString(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (!url) {
    throw new Error(
      "No Postgres connection string found. Set DATABASE_URL (or POSTGRES_URL) " +
        "to a Neon/Postgres connection string — see .env.example. Unlike the " +
        "previous SQLite/libSQL setup, there is no local-file fallback for " +
        "Postgres; local development needs a real connection string too " +
        "(a free Neon database works fine for this)."
    );
  }

  return url;
}

async function createConnection(): Promise<Db> {
  // fullResults: true makes every query return { rows, rowCount, ... }
  // (matching what our QueryResult/rowsAffected shape expects) instead of
  // a bare array of rows, which is the driver's default for the plain
  // template-tag form.
  const sql = neon(resolveConnectionString(), { fullResults: true });

  const db: Db = {
    async execute<T>(
      input: { sql: string; args?: InArgs } | string
    ): Promise<QueryResult<T>> {
      const { sql: sqlText, args } =
        typeof input === "string" ? { sql: input, args: undefined } : input;

      const { text, values } = toPositional(sqlText, args);
      const result = await sql(text, values);

      return {
        rows: result.rows as T[],
        rowsAffected: result.rowCount ?? 0,
      };
    },

    async batch(statements, _mode) {
      // Neon's HTTP driver has no persistent session, so batching means a
      // single non-interactive transaction request rather than BEGIN/COMMIT
      // over a held connection — see sql.transaction() in Neon's docs.
      const queries = statements.map((statement) => {
        const { text, values } = toPositional(statement.sql, statement.args);
        return sql(text, values);
      });

      await sql.transaction(queries);
    },
  };

  await runMigrations(db);

  return db;
}

/**
 * Postgres equivalent of SQLite's `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
 * default — used wherever the schema wants the database itself (rather
 * than application code) to stamp the current UTC time as an ISO-8601
 * string, so existing string-based comparisons/LIKE-prefix date matching
 * elsewhere in the app keep working unchanged.
 */
export const NOW_ISO_SQL =
  `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

async function runMigrations(db: Db): Promise<void> {
  /*
   * The CREATE TABLE statements below represent the current schema.
   *
   * Existing databases may have older versions of these tables. The
   * additive migrations further below bring those databases forward
   * without destroying existing data.
   *
   * These run as a single transaction so the initial schema is created
   * atomically on a brand-new database.
   */
  await db.batch(
    [
      {
        sql: `CREATE TABLE IF NOT EXISTS products (
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
          created_at          TEXT NOT NULL DEFAULT (${NOW_ISO_SQL}),
          updated_at          TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },

      {
        sql: `CREATE TABLE IF NOT EXISTS agent_tasks (
          id                   TEXT PRIMARY KEY,
          user_id              TEXT NOT NULL,
          parent_task_id       TEXT REFERENCES agent_tasks(id),
          title                TEXT NOT NULL,
          description          TEXT,
          task_type            TEXT NOT NULL,
          status               TEXT NOT NULL,
          priority             TEXT NOT NULL DEFAULT 'normal',
          created_at           TEXT NOT NULL DEFAULT (${NOW_ISO_SQL}),
          started_at           TEXT,
          updated_at           TEXT NOT NULL DEFAULT (${NOW_ISO_SQL}),
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
        )`,
      },

      { sql: `CREATE INDEX IF NOT EXISTS idx_tasks_user ON agent_tasks(user_id)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON agent_tasks(parent_task_id)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_tasks_status ON agent_tasks(status)` },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_tasks_claim
          ON agent_tasks(parent_task_id, status, next_retry_at)`,
      },

      {
        sql: `CREATE TABLE IF NOT EXISTS activity_events (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          task_id     TEXT REFERENCES agent_tasks(id),
          event_type  TEXT NOT NULL,
          message     TEXT NOT NULL,
          metadata    TEXT,
          severity    TEXT NOT NULL DEFAULT 'info',
          created_at  TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },

      { sql: `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_events(user_id)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_activity_task ON activity_events(task_id)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at)` },

      {
        sql: `CREATE TABLE IF NOT EXISTS chat_messages (
          id              TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          user_id         TEXT NOT NULL,
          role            TEXT NOT NULL,
          content         TEXT NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },

      {
        sql: `CREATE INDEX IF NOT EXISTS idx_chat_conversation
          ON chat_messages(user_id, conversation_id, created_at)`,
      },

      /*
       * Milestone 3D — Prospect intelligence. See the original schema
       * comment history in git for the full rationale; unchanged here
       * beyond the Postgres syntax translation.
       */
      {
        sql: `CREATE TABLE IF NOT EXISTS prospects (
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
          created_at            TEXT NOT NULL DEFAULT (${NOW_ISO_SQL}),
          updated_at            TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },
    ],
    "write"
  );

  /*
   * -------------------------------------------------------------------
   * Additive migrations. Postgres equivalent of the old
   * `PRAGMA table_info(x)` introspection: information_schema.columns.
   * -------------------------------------------------------------------
   */
  async function existingColumns(table: string): Promise<Set<string>> {
    const result = await db.execute<{ name: string }>({
      sql: `SELECT column_name AS name FROM information_schema.columns WHERE table_name = ?`,
      args: [table],
    });
    return new Set(result.rows.map((r) => r.name));
  }

  async function addColumnsIfMissing(
    table: string,
    additions: Array<[string, string]>
  ): Promise<void> {
    const columns = await existingColumns(table);

    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        await db.execute(
          `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`
        );
      }
    }
  }

  await addColumnsIfMissing("agent_tasks", [
    ["worker_id", "TEXT"],
    ["execution_id", "TEXT"],
    ["heartbeat_at", "TEXT"],
    ["last_attempt_at", "TEXT"],
    ["result_json", "TEXT"],
    ["input_reason", "TEXT"],
  ]);

  await addColumnsIfMissing("products", [
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
  ]);

  const activityColumns = await existingColumns("activity_events");
  if (!activityColumns.has("severity")) {
    await db.execute(
      `ALTER TABLE activity_events ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'`
    );
  }

  await addColumnsIfMissing("prospects", [
    ["user_id", "TEXT"],
    ["source_task_id", "TEXT"],
    ["email", "TEXT"],
    ["product_id", "TEXT"],
  ]);

  /*
   * Prospect indexes — created AFTER the additive column migrations
   * above, same reasoning as before: existing databases may predate
   * user_id/source_task_id/product_id/email.
   */
  await db.batch(
    [
      { sql: `CREATE INDEX IF NOT EXISTS idx_prospects_user ON prospects(user_id)` },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_prospects_qualification
          ON prospects(qualification_status)`,
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_prospects_type ON prospects(prospect_type)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_prospects_product ON prospects(product_id)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email)` },
      { sql: `CREATE INDEX IF NOT EXISTS idx_prospects_created ON prospects(created_at)` },
    ],
    "write"
  );
}

/**
 * Returns a singleton database connection.
 *
 * Cached on globalThis so Next.js dev hot-reload and repeated serverless
 * invocations within the same warm instance don't reconnect/re-migrate
 * on every call.
 */
export function getDb(): Promise<Db> {
  if (!global.__innocentIntelligenceDb) {
    global.__innocentIntelligenceDb = createConnection();
  }

  return global.__innocentIntelligenceDb;
}
