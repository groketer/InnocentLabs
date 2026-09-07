/**
 * get_activity_summary tool.
 *
 * MILESTONE 3W — platform-wide reasoning audit.
 *
 * Part of a systematic fix, not a one-off: the chat agent had tools for
 * settings, prospects, follow-ups, and (now) the product list, but
 * nothing for the operational activity log — a real gap of the exact
 * same shape as the settings and product-count bugs already found and
 * fixed. Without this, asked "what's been happening" or "any errors
 * recently", the agent had nothing live to check.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { listActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const getActivitySummaryTool = tool({
  name: "get_activity_summary",

  description: `
Retrieve recent operational activity — task completions, failures,
escalations, recoveries — read live from the database, the same feed
shown on the Activity page.

Use this for anything about what the system has actually been doing:
"what's happened recently", "any errors", "has X run today", "what
needs attention". Never guess or answer from general impressions about
what the system probably did — check.
`,

  parameters: z.object({
    limit: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("How many recent events to retrieve. Defaults to 20."),
  }),

  async execute({ limit }) {
    const events = await listActivity({
      user_id: LOCAL_USER_ID,
      limit: limit ?? 20,
    });

    return {
      success: true,
      count: events.length,
      events: events.map((e) => ({
        at: e.created_at,
        type: e.event_type,
        message: e.message,
      })),
      source: "Live query against the activity log, just now.",
    };
  },
});
