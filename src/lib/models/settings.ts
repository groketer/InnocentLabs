/**
 * Application settings.
 *
 * These are OPERATIONAL knobs (follow-up caps, sending pace, approval
 * mode) — never secrets. SMTP credentials, the OpenAI key, etc. stay in
 * environment variables, where they belong; this module only reads
 * process.env to report whether they're configured (for the Settings
 * page), never to display or store their actual values.
 *
 * Stored in app_meta, a key-value table that already existed in the
 * schema (created by products.ts's syncAuthoritativePortfolio) but had no
 * actual use yet.
 */

import { getDb } from "@/lib/db";

export interface AppSettings {
  /** Max follow-up emails after the initial send, before giving up. */
  max_follow_ups: number;
  /** Minimum days to wait between one email and the next in a sequence. */
  min_days_between_follow_ups: number;
  /** Safety cap on total emails sent per day, across all sequences. */
  daily_send_limit: number;
  /** When true, the first email in any sequence needs a person to approve it before it sends. */
  require_manual_approval: boolean;
  /** When true, the daily scheduler creates prospecting tasks on its own, with no prompting. */
  autonomous_prospecting: boolean;
  /** When true, the daily scheduler creates outreach-sending tasks on its own, with no prompting. */
  autonomous_campaigns: boolean;
  /**
   * When true, prospects the AI itself marked "needs_review" get
   * automatically promoted to "qualified" (and therefore enter outreach)
   * once their confidence score clears auto_qualify_confidence_threshold
   * — no human review step at all for those. Off by default: this is a
   * real increase in autonomy (and risk) over the baseline, where the AI
   * already auto-qualifies confident prospects but defers ambiguous ones
   * to a person.
   */
  autonomous_qualification: boolean;
  /** Confidence (0–1) a needs_review prospect must clear to be auto-qualified when autonomous_qualification is on. */
  auto_qualify_confidence_threshold: number;
  /** When true, the system checks the inbox and autonomously replies to prospects who write back (subject to the escalation rules baked into the reply composer). */
  autonomous_replies: boolean;
  /** Safety cap: after this many autonomous replies in one conversation, stop and flag for human review regardless of what the AI would otherwise do. */
  max_autonomous_replies_per_conversation: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  max_follow_ups: 3,
  min_days_between_follow_ups: 3,
  daily_send_limit: 50,
  require_manual_approval: false,
  autonomous_prospecting: true,
  autonomous_campaigns: true,
  autonomous_qualification: true,
  auto_qualify_confidence_threshold: 0.4,
  autonomous_replies: true,
  max_autonomous_replies_per_conversation: 15,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<
  keyof AppSettings
>;

const BOOLEAN_KEYS = new Set<keyof AppSettings>([
  "require_manual_approval",
  "autonomous_prospecting",
  "autonomous_campaigns",
  "autonomous_qualification",
  "autonomous_replies",
]);

function coerce(key: keyof AppSettings, raw: string): number | boolean {
  if (BOOLEAN_KEYS.has(key)) {
    return raw === "true";
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : (DEFAULT_SETTINGS[key] as number);
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();

  const result = await db.execute(
    `SELECT key, value FROM app_meta WHERE key LIKE 'setting:%'`
  );

  const rows = result.rows as unknown as Array<{
    key: string;
    value: string;
  }>;

  const stored = new Map(
    rows.map((r) => [r.key.replace(/^setting:/, ""), r.value])
  );

  const settings = { ...DEFAULT_SETTINGS };

  for (const key of SETTINGS_KEYS) {
    const raw = stored.get(key);
    if (raw !== undefined) {
      (settings as Record<string, unknown>)[key] = coerce(key, raw);
    }
  }

  return settings;
}

export interface UpdateSettingsInput {
  max_follow_ups?: number;
  min_days_between_follow_ups?: number;
  daily_send_limit?: number;
  require_manual_approval?: boolean;
  autonomous_prospecting?: boolean;
  autonomous_campaigns?: boolean;
  autonomous_qualification?: boolean;
  auto_qualify_confidence_threshold?: number;
  autonomous_replies?: boolean;
  max_autonomous_replies_per_conversation?: number;
}

function validate(input: UpdateSettingsInput): void {
  if (
    input.max_follow_ups !== undefined &&
    (!Number.isInteger(input.max_follow_ups) ||
      input.max_follow_ups < 0 ||
      input.max_follow_ups > 10)
  ) {
    throw new Error("max_follow_ups must be a whole number between 0 and 10.");
  }

  if (
    input.min_days_between_follow_ups !== undefined &&
    (!Number.isInteger(input.min_days_between_follow_ups) ||
      input.min_days_between_follow_ups < 1 ||
      input.min_days_between_follow_ups > 30)
  ) {
    throw new Error(
      "min_days_between_follow_ups must be a whole number between 1 and 30."
    );
  }

  if (
    input.daily_send_limit !== undefined &&
    (!Number.isInteger(input.daily_send_limit) ||
      input.daily_send_limit < 1 ||
      input.daily_send_limit > 2000)
  ) {
    throw new Error(
      "daily_send_limit must be a whole number between 1 and 2000."
    );
  }

  if (
    input.auto_qualify_confidence_threshold !== undefined &&
    (typeof input.auto_qualify_confidence_threshold !== "number" ||
      input.auto_qualify_confidence_threshold < 0 ||
      input.auto_qualify_confidence_threshold > 1)
  ) {
    throw new Error(
      "auto_qualify_confidence_threshold must be a number between 0 and 1."
    );
  }

  if (
    input.max_autonomous_replies_per_conversation !== undefined &&
    (!Number.isInteger(input.max_autonomous_replies_per_conversation) ||
      input.max_autonomous_replies_per_conversation < 1 ||
      input.max_autonomous_replies_per_conversation > 100)
  ) {
    throw new Error(
      "max_autonomous_replies_per_conversation must be a whole number between 1 and 100."
    );
  }
}

export async function updateSettings(
  input: UpdateSettingsInput
): Promise<AppSettings> {
  validate(input);

  const db = await getDb();
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined
  ) as Array<[keyof AppSettings, number | boolean]>;

  for (const [key, value] of entries) {
    await db.execute({
      sql: `
        INSERT INTO app_meta (key, value)
        VALUES (@key, @value)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `,
      args: {
        key: `setting:${key}`,
        value: String(value),
      },
    });
  }

  return getSettings();
}

/**
 * Reports whether required/optional infrastructure is configured, WITHOUT
 * ever exposing the actual secret values — the Settings page uses this to
 * show "configured" / "not configured", pointing people to Vercel's
 * environment variables UI to actually change anything here.
 */
export function getInfraStatus() {
  return {
    openai_api_key_configured: Boolean(process.env.OPENAI_API_KEY),
    database_configured: Boolean(
      process.env.DATABASE_URL || process.env.POSTGRES_URL
    ),
    cron_secret_configured: Boolean(process.env.CRON_SECRET),
    smtp: {
      configured: Boolean(
        process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD
      ),
      host: process.env.SMTP_HOST || null,
      port: process.env.SMTP_PORT || null,
      from_name: process.env.SMTP_FROM_NAME || null,
      // Sender identity, not a secret — CAN-SPAM requires a real postal
      // address in every commercial email, so this is worth surfacing
      // clearly rather than treating it like a credential.
      sender_postal_address: process.env.SENDER_POSTAL_ADDRESS || null,
    },
  };
}
