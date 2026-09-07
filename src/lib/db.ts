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

/**
 * Safely merges duplicate prospects (same user_id, product_id, and email,
 * case-insensitive) before a hard uniqueness constraint gets added on top
 * of this. Keeps the OLDEST row in each duplicate group — it's the one
 * most likely to have a source_task_id, evidence, and any manual
 * qualification triage a person already did — and reassigns any
 * email_sends history from the newer duplicate(s) to it before removing
 * them, so no send history is lost and no foreign key is ever left
 * dangling.
 *
 * Idempotent: once no duplicate groups remain, this is a fast no-op
 * (a single query returning zero rows).
 */
async function dedupeProspectsByEmail(db: Db): Promise<void> {
  const groups = await db.execute<{
    user_id: string;
    product_id: string | null;
    ids: string[];
  }>(`
    SELECT user_id, product_id, array_agg(id ORDER BY created_at ASC) AS ids
    FROM prospects
    WHERE email IS NOT NULL
    GROUP BY user_id, product_id, lower(email)
    HAVING COUNT(*) > 1
  `);

  for (const group of groups.rows) {
    const [keepId, ...duplicateIds] = group.ids;

    for (const duplicateId of duplicateIds) {
      await db.execute({
        sql: `UPDATE email_sends SET prospect_id = ? WHERE prospect_id = ?`,
        args: [keepId, duplicateId],
      });

      await db.execute({
        sql: `DELETE FROM prospects WHERE id = ?`,
        args: [duplicateId],
      });
    }
  }
}

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
    // MILESTONE 3F — Follow-up campaigns.
    // sequence_status: not_started | pending_approval | active | completed
    //                  | unsubscribed | responded | paused
    ["sequence_status", "TEXT NOT NULL DEFAULT 'not_started'"],
    ["emails_sent", "INTEGER NOT NULL DEFAULT 0"],
    ["last_sent_at", "TEXT"],
    ["next_send_at", "TEXT"],
    ["unsubscribe_token", "TEXT"],
  ]);

  /*
   * MILESTONE 3H — Duplicate prospects.
   *
   * A duplicate prospect (same user, same product, same email) was
   * observed in production — the application-level check in
   * executors/prospecting.ts's isDuplicateProspect() looked correct on
   * review, but relying solely on app-level logic for a uniqueness
   * guarantee is inherently fragile against races, retries, and edge
   * cases. This adds a real database-level constraint as the actual
   * source of truth.
   *
   * IMPORTANT: this can't just be a CREATE UNIQUE INDEX — Postgres
   * refuses to create one over data that already violates it, which
   * would break every future deploy for anyone who already has a
   * duplicate (as this user does). So this first safely MERGES any
   * existing duplicate groups (keeping the oldest row, reassigning any
   * email_sends history to it before removing the newer duplicate(s))
   * and only then adds the constraint. Idempotent and safe to run on
   * every boot: once there are no duplicate groups left, the dedup step
   * is a no-op and the index creation is a no-op.
   */
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
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_prospects_sequence_status
          ON prospects(sequence_status)`,
      },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_prospects_next_send
          ON prospects(next_send_at)`,
      },
      {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_unsubscribe_token
          ON prospects(unsubscribe_token)`,
      },
    ],
    "write"
  );

  /*
   * -------------------------------------------------------------------
   * MILESTONE 3F — Follow-up campaigns: outbound send audit trail.
   * -------------------------------------------------------------------
   *
   * One row per actually-sent (or attempted) email. This is what the
   * Follow-ups view shows as history, and what a future round composing
   * a follow-up can look back on to avoid repeating itself.
   */
  await db.batch(
    [
      {
        sql: `CREATE TABLE IF NOT EXISTS email_sends (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL,
          prospect_id  TEXT NOT NULL REFERENCES prospects(id),
          task_id      TEXT REFERENCES agent_tasks(id),
          step         INTEGER NOT NULL,
          subject      TEXT NOT NULL,
          body         TEXT NOT NULL,
          status       TEXT NOT NULL,
          error_message TEXT,
          sent_at      TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_email_sends_prospect
          ON email_sends(prospect_id)`,
      },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_email_sends_user
          ON email_sends(user_id)`,
      },
    ],
    "write"
  );

  /*
   * MILESTONE 3J — Inbound email: replies and bounces.
   *
   * email_sends needs a couple of additions to support this:
   * - direction: distinguishes an outbound cold/follow-up email from an
   *   autonomous reply sent back to someone who wrote in.
   * - message_id: the RFC 5322 Message-ID nodemailer generated for this
   *   send, captured so a LATER reply-to-a-reply can be threaded
   *   correctly (In-Reply-To/References headers).
   * - in_reply_to: the Message-ID of the inbound email this one is
   *   replying to, if any.
   */
  const emailSendsColumns = await existingColumns("email_sends");

  if (!emailSendsColumns.has("direction")) {
    await db.execute(
      `ALTER TABLE email_sends ADD COLUMN direction TEXT NOT NULL DEFAULT 'outbound'`
    );
  }
  if (!emailSendsColumns.has("message_id")) {
    await db.execute(`ALTER TABLE email_sends ADD COLUMN message_id TEXT`);
  }
  if (!emailSendsColumns.has("in_reply_to")) {
    await db.execute(`ALTER TABLE email_sends ADD COLUMN in_reply_to TEXT`);
  }

  /*
   * One row per inbound email the IMAP checker has seen, whether it
   * turned out to be a genuine reply, a bounce notification, an
   * auto-reply (vacation responder etc. — never worth replying to), or
   * something from an unrecognized sender. This is both the audit trail
   * (so a person can see exactly what came in and how it was handled)
   * and the idempotency guard (message_id is unique, so re-fetching the
   * same email twice — e.g. from overlapping IMAP checks — never
   * processes it twice).
   */
  await db.batch(
    [
      {
        sql: `CREATE TABLE IF NOT EXISTS inbound_emails (
          id             TEXT PRIMARY KEY,
          user_id        TEXT NOT NULL,
          prospect_id    TEXT REFERENCES prospects(id),
          message_id     TEXT,
          from_address   TEXT NOT NULL,
          subject        TEXT,
          body           TEXT,
          classification TEXT NOT NULL,
          handled        TEXT NOT NULL DEFAULT 'pending',
          note           TEXT,
          received_at    TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_inbound_emails_prospect
          ON inbound_emails(prospect_id)`,
      },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_inbound_emails_user
          ON inbound_emails(user_id)`,
      },
      {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_emails_message_id
          ON inbound_emails(message_id) WHERE message_id IS NOT NULL`,
      },
    ],
    "write"
  );

  /*
   * MILESTONE 3H — Duplicate prospects.
   *
   * A duplicate prospect (same user, same product, same email) was
   * observed in production — the application-level check in
   * executors/prospecting.ts's isDuplicateProspect() looked correct on
   * review, but relying solely on app-level logic for a uniqueness
   * guarantee is inherently fragile against races, retries, and edge
   * cases. This adds a real database-level constraint as the actual
   * source of truth.
   *
   * IMPORTANT: this can't just be a CREATE UNIQUE INDEX — Postgres
   * refuses to create one over data that already violates it, which
   * would break every future deploy for anyone who already has a
   * duplicate (as this user does). So this first safely MERGES any
   * existing duplicate groups (keeping the oldest row, reassigning any
   * email_sends history to it before removing the newer duplicate(s))
   * and only then adds the constraint. Idempotent and safe to run on
   * every boot: once there are no duplicate groups left, the dedup step
   * is a no-op and the index creation is a no-op.
   *
   * Must run AFTER email_sends exists (immediately above) — the dedup
   * step reassigns rows in that table before deleting a duplicate.
   */
  await dedupeProspectsByEmail(db);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prospects_unique_email_per_product
    ON prospects (user_id, product_id, lower(email))
    WHERE email IS NOT NULL
  `);

  /*
   * MILESTONE 3L — cost visibility.
   *
   * The system now runs five separate AI-driven jobs continuously and
   * autonomously (prospecting, auditing, qualification's own reasoning is
   * free/local but the others aren't, campaigns, replies). There was no
   * visibility anywhere into what that actually costs. One row per OpenAI
   * call, everywhere one is made.
   */
  await db.batch(
    [
      {
        sql: `CREATE TABLE IF NOT EXISTS api_usage (
          id             TEXT PRIMARY KEY,
          user_id        TEXT NOT NULL,
          source         TEXT NOT NULL,
          model          TEXT NOT NULL,
          input_tokens   INTEGER NOT NULL,
          output_tokens  INTEGER NOT NULL,
          estimated_cost_usd REAL NOT NULL,
          created_at     TEXT NOT NULL DEFAULT (${NOW_ISO_SQL})
        )`,
      },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_api_usage_user_created
          ON api_usage(user_id, created_at)`,
      },
    ],
    "write"
  );

  /*
   * MILESTONE 3O — geographic targeting per product.
   *
   * A free-text field the prospecting agent treats as a hard directive
   * when searching for a given product (e.g. "Kenya first, then Eastern
   * Africa"), rather than searching globally with no geographic
   * awareness. Free text rather than a rigid structured field — some
   * products may want city-level targeting, others continent-level, or
   * exclusions ("not X") — this needs to accommodate whatever shape of
   * instruction actually makes sense for a given product.
   */
  const productsColumns = await existingColumns("products");
  if (!productsColumns.has("geographic_focus")) {
    await db.execute(`ALTER TABLE products ADD COLUMN geographic_focus TEXT`);
  }

  /*
   * MILESTONE 3R — international-timezone-aware sending.
   *
   * The prospect's own country, when known — used to send during THEIR
   * business hours rather than the sender's, or a single fixed window.
   * A person in Nairobi and a person in Toronto shouldn't be emailed at
   * the same wall-clock time just because both emails went out from the
   * same sending account.
   */
  const prospectsColumns = await existingColumns("prospects");
  if (!prospectsColumns.has("country")) {
    await db.execute(`ALTER TABLE prospects ADD COLUMN country TEXT`);
  }
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
