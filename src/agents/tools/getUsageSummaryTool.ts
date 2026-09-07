/**
 * get_usage_summary tool.
 *
 * MILESTONE 3W — platform-wide reasoning audit.
 *
 * Same gap, same fix pattern: cost tracking exists and is shown on the
 * Dashboard, but the chat agent had no way to answer "how much have we
 * spent on AI" without this. Spend changes daily — anything other than
 * a live check would be a guess dressed up as an answer.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getUsageSummary } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const getUsageSummaryTool = tool({
  name: "get_usage_summary",

  description: `
Retrieve actual, current estimated AI (OpenAI) spend — today, this
month, and broken down by which job is spending it (prospecting,
auditing, email composition, replies, chat, deep qualification).

Use this for any question about cost or spend. Never estimate or guess a
figure — this changes daily as the system runs, so anything not read
live here would be fabricated.
`,

  parameters: z.object({}),

  async execute() {
    const usage = await getUsageSummary(LOCAL_USER_ID);

    return {
      success: true,
      cost_today_usd: usage.cost_today,
      cost_this_month_usd: usage.cost_this_month,
      calls_today: usage.calls_today,
      by_source_this_month: usage.by_source_this_month,
      source: "Live query against recorded API usage, just now.",
      note: "Cost estimates use approximate current OpenAI pricing — treat as directionally accurate, not a penny-perfect invoice.",
    };
  },
});
