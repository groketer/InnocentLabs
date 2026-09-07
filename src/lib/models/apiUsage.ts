/**
 * MILESTONE 3L — cost visibility.
 *
 * Tracks estimated OpenAI API cost across every AI-driven job in the
 * system, so autonomous 24/7 operation doesn't run up unnoticed spend.
 *
 * PRICING: hardcoded below, current as of this writing. OpenAI pricing
 * changes over time — if these numbers look stale, check
 * https://openai.com/api/pricing and update PRICING_PER_MILLION_TOKENS.
 * Getting this exactly right matters less than it sounds: this is meant
 * to catch "did something run away and cost 100x normal," not to be a
 * penny-accurate invoice.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";

const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
};

const DEFAULT_PRICING = PRICING_PER_MILLION_TOKENS["gpt-4.1-mini"];

export type UsageSource =
  | "prospecting"
  | "portfolio_refresh"
  | "website_audit"
  | "email_compose"
  | "reply_compose"
  | "deep_qualification"
  | "chat";

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rate = PRICING_PER_MILLION_TOKENS[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

export async function recordApiUsage(input: {
  user_id: string;
  source: UsageSource;
  model: string;
  input_tokens: number;
  output_tokens: number;
}): Promise<void> {
  try {
    const db = await getDb();
    const cost = estimateCost(input.model, input.input_tokens, input.output_tokens);

    await db.execute({
      sql: `
        INSERT INTO api_usage (id, user_id, source, model, input_tokens, output_tokens, estimated_cost_usd)
        VALUES (@id, @user_id, @source, @model, @input_tokens, @output_tokens, @cost)
      `,
      args: {
        id: randomUUID(),
        user_id: input.user_id,
        source: input.source,
        model: input.model,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        cost,
      },
    });
  } catch (error) {
    // Usage tracking must never be able to break the actual AI call it's
    // measuring — log and move on.
    console.error("[apiUsage] Could not record usage:", error);
  }
}

export interface UsageSummary {
  cost_today: number;
  cost_this_month: number;
  calls_today: number;
  by_source_this_month: Array<{ source: string; cost: number; calls: number }>;
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const db = await getDb();
  const todayPrefix = `${new Date().toISOString().slice(0, 10)}%`;
  const monthPrefix = `${new Date().toISOString().slice(0, 7)}%`;

  const [todayResult, monthResult, bySourceResult] = await Promise.all([
    db.execute({
      sql: `SELECT COALESCE(SUM(estimated_cost_usd),0) as cost, COUNT(*) as calls FROM api_usage WHERE user_id = ? AND created_at LIKE ?`,
      args: [userId, todayPrefix],
    }),
    db.execute({
      sql: `SELECT COALESCE(SUM(estimated_cost_usd),0) as cost FROM api_usage WHERE user_id = ? AND created_at LIKE ?`,
      args: [userId, monthPrefix],
    }),
    db.execute({
      sql: `
        SELECT source, SUM(estimated_cost_usd) as cost, COUNT(*) as calls
        FROM api_usage
        WHERE user_id = ? AND created_at LIKE ?
        GROUP BY source
        ORDER BY cost DESC
      `,
      args: [userId, monthPrefix],
    }),
  ]);

  const todayRow = todayResult.rows[0] as unknown as { cost: number | string; calls: number | string };
  const monthRow = monthResult.rows[0] as unknown as { cost: number | string };

  return {
    cost_today: Number(todayRow?.cost ?? 0),
    cost_this_month: Number(monthRow?.cost ?? 0),
    calls_today: Number(todayRow?.calls ?? 0),
    by_source_this_month: (
      bySourceResult.rows as unknown as Array<{
        source: string;
        cost: number | string;
        calls: number | string;
      }>
    ).map((r) => ({
      source: r.source,
      cost: Number(r.cost),
      calls: Number(r.calls),
    })),
  };
}
