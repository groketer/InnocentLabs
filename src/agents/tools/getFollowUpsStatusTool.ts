/**
 * get_followups_status tool.
 *
 * MILESTONE 3Q — chat integration with the rest of the system.
 *
 * Read-only access to outreach sequence / conversation status — the
 * Follow-ups page's data. Without this, the chat agent had no way to
 * answer "what's happening in Follow-ups" or "does anything need my
 * attention" — it could read prospects and products, but had no
 * visibility into the outreach/conversation layer at all.
 *
 * Like get_prospects, this is strictly read-only: it cannot approve,
 * pause, or reply to anything. Taking action on a specific sequence still
 * happens on the Follow-ups page itself.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { listActiveSequences, type Prospect } from "@/lib/models/prospects";
import { getProductByName } from "@/lib/models/products";
import type { AgentRunContext } from "@/agents/context";

const inputSchema = z.object({
  product_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Innocent Labs product name to filter to, e.g. 'UHIKO Properties'."
    ),

  needs_attention_only: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, only return sequences that actually need Innocent's attention (pending_approval or needs_human_reply) rather than the full list."
    ),
});

export const getFollowUpsStatusTool = tool({
  name: "get_followups_status",

  description: `
Retrieve the current state of outreach sequences and conversations — the
same data shown on the Follow-ups page.

This tool is READ-ONLY. It does NOT approve sequences, reply to anyone,
pause/resume anything, or send any email. It only reports what has
actually been persisted.

Use this when Innocent asks things like "what's happening with
follow-ups", "does anything need my attention", "how many people have
replied", or "what's the status of outreach for <product>".

Statuses you may see:
- pending_approval: waiting on Innocent to approve the first send
- active: an outreach sequence is in progress
- in_conversation: the prospect replied and the agent is handling an
  ongoing back-and-forth autonomously
- needs_human_reply: the agent escalated — this genuinely needs
  Innocent's attention, unlike every other status here
- responded / completed / paused / bounced / unsubscribed: various
  terminal or paused states

Set needs_attention_only to true when Innocent is specifically asking
what needs his attention, to avoid burying the actually-important items
in a long list.
`,

  parameters: inputSchema,

  async execute(input, runContext) {
    const ctx = runContext?.context as AgentRunContext | undefined;
    const userId = ctx?.userId;

    if (!userId) {
      return {
        success: false,
        error: "No user identity was available in the current AgentRunContext.",
      };
    }

    let productId: string | undefined;
    if (input.product_name) {
      const product = await getProductByName(input.product_name.trim());
      if (!product) {
        return {
          success: true,
          count: 0,
          sequences: [],
          message: `No Innocent Labs product named "${input.product_name.trim()}" exists in the portfolio.`,
        };
      }
      productId = product.id;
    }

    const all = await listActiveSequences(userId);
    const filtered = productId
      ? all.filter((p) => p.product_id === productId)
      : all;

    const relevant = input.needs_attention_only
      ? filtered.filter((p) =>
          ["pending_approval", "needs_human_reply"].includes(p.sequence_status)
        )
      : filtered;

    const statusCounts: Record<string, number> = {};
    for (const p of filtered) {
      statusCounts[p.sequence_status] = (statusCounts[p.sequence_status] ?? 0) + 1;
    }

    return {
      success: true,
      count: relevant.length,
      status_counts_across_all_matching: statusCounts,
      sequences: relevant.map(formatSequence),
      source: "Persisted sequence data from the Follow-ups system.",
      interpretation:
        relevant.length > 0
          ? "These are real, persisted sequence records."
          : input.needs_attention_only
            ? "Nothing currently needs attention — no pending approvals or escalations."
            : "No sequences matched the given filters.",
    };
  },
});

function formatSequence(p: Prospect) {
  return {
    prospect_id: p.id,
    name: p.name,
    organization: p.organization ?? null,
    email: p.email ?? null,
    sequence_status: p.sequence_status,
    emails_sent: p.emails_sent,
    product_id: p.product_id ?? null,
    updated_at: p.updated_at,
  };
}
