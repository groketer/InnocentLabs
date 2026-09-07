/**
 * get_product_insights tool.
 *
 * MILESTONE 3W — platform-wide reasoning audit.
 *
 * Same gap again: the Products page shows a real conversion funnel
 * (found → qualified → emailed → replied) per product, computed live —
 * but the chat agent had no way to answer "which product is converting
 * best" or "what's our reply rate for X" without this. This is exactly
 * the kind of question that changes by the day and must never be
 * answered from impression or memory.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getInsightsByProduct } from "@/lib/models/insights";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const getProductInsightsTool = tool({
  name: "get_product_insights",

  description: `
Retrieve the actual, current conversion funnel per product — prospects
found, qualified, emailed, replied, bounced, unsubscribed — read live
from the database, the same numbers shown on the Products page.

Use this for any question comparing products, asking about reply rates,
bounce rates, or "what's working" — never estimate or recall a figure
from earlier in the conversation, since these numbers change constantly
as the system runs.
`,

  parameters: z.object({}),

  async execute() {
    const insights = await getInsightsByProduct(LOCAL_USER_ID);

    return {
      success: true,
      products: insights,
      source: "Live query against prospects and correspondence data, just now.",
    };
  },
});
