/**
 * get_prospects tool.
 *
 * Milestone 3D.4+
 *
 * Read-only access to prospect intelligence that has actually been
 * persisted by the prospecting task engine.
 *
 * IMPORTANT:
 * This tool does not perform web research.
 * It does not discover new prospects.
 * It does not contact prospects.
 *
 * Its job is simply to expose persisted prospect intelligence to the
 * Master Agent.
 *
 * The current user is obtained from AgentRunContext rather than being
 * supplied by the model. This prevents retrieval failures caused by the
 * model supplying an incorrect or incomplete user_id.
 *
 * Product filtering may be performed using the human-readable product name.
 * The tool resolves that name against the authoritative portfolio and then
 * uses the internal product ID for database retrieval.
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  listProspects,
  type Prospect,
} from "@/lib/models/prospects";

import {
  getProductByName,
} from "@/lib/models/products";

import type { AgentRunContext } from "@/agents/context";

const inputSchema = z.object({
  product_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional Innocent Labs product name, such as 'PRFed'. When supplied, only prospects linked to that product are returned."
    ),

  qualification_status: z
    .enum([
      "candidate",
      "qualified",
      "unqualified",
      "needs_review",
    ])
    .optional()
    .describe(
      "Optional qualification filter."
    ),

  prospect_type: z
    .enum([
      "person",
      "organization",
      "partner",
      "investor",
      "customer",
      "publisher",
      "other",
    ])
    .optional()
    .describe(
      "Optional prospect-type filter."
    ),

  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(25)
    .describe(
      "Maximum number of prospect records to return. Defaults to 25."
    ),
});

export const getProspectsTool = tool({
  name: "get_prospects",

  description: `
Retrieve prospect intelligence that has ACTUALLY been persisted by
Innocent Intelligence.

This tool is READ-ONLY.

It does NOT:
- perform web research;
- discover prospects;
- create prospects;
- contact prospects;
- send messages;
- infer missing prospects;
- claim that prospects exist when no records are returned.

IMPORTANT:

The current user's identity is supplied by Innocent Intelligence's runtime
context. Do NOT ask the user for a user_id and do NOT invent one.

When Innocent asks about prospects for a particular Innocent Labs product,
use product_name, for example "PRFed".

A returned prospect is a persisted database record. The existence of a
record means that the prospecting system persisted it as a potential
prospect; it does NOT by itself establish buying intent, willingness to buy,
or confirmed customer status.

If count is zero, explicitly state that no persisted prospect records
matching the requested filters were found.

Never substitute general knowledge, previous research, or assumptions for
an empty database result.
`,

  parameters: inputSchema,

  async execute(input, runContext) {
    const ctx = runContext?.context as AgentRunContext | undefined;

    const userId = ctx?.userId;

    /*
     * The user ID is a runtime identity, not model-generated input.
     */
    if (!userId) {
      return {
        success: false,
        count: 0,
        prospects: [],
        source:
          "Persisted prospect intelligence from the Innocent Intelligence database.",

        error:
          "No user identity was available in the current AgentRunContext. Prospect retrieval was not performed.",

        important_note:
          "No database conclusion should be drawn when runtime user identity is unavailable.",
      };
    }

    /*
     * Resolve the optional human-readable product name through the
     * authoritative portfolio.
     *
     * We deliberately do not let the model supply an internal product UUID.
     */
    let productId: string | undefined;

    if (input.product_name) {
      const product = await getProductByName(input.product_name.trim());

      if (!product) {
        return {
          success: true,
          count: 0,
          prospects: [],

          requested_product: input.product_name.trim(),

          source:
            "Persisted prospect intelligence from the Innocent Intelligence database.",

          message:
            `No Innocent Labs product named "${input.product_name.trim()}" exists in the authoritative portfolio.`,

          important_note:
            "No prospect records were queried because the requested product could not be resolved against the authoritative portfolio.",
        };
      }

      productId = product.id;
    }

    const prospects = await listProspects(userId, {
      product_id: productId,
      qualification_status: input.qualification_status,
      prospect_type: input.prospect_type,
      limit: input.limit,
    });

    return {
      success: true,

      count: prospects.length,

      requested_product:
        input.product_name?.trim() ?? null,

      filters: {
        qualification_status:
          input.qualification_status ?? null,

        prospect_type:
          input.prospect_type ?? null,

        limit: input.limit,
      },

      prospects: prospects.map(formatProspect),

      source:
        "Persisted prospect intelligence from the Innocent Intelligence database.",

      interpretation:
        prospects.length > 0
          ? "These are prospect records actually persisted in the database. Their existence does not establish buying intent or confirmed customer status."
          : "No persisted prospect records matched the requested filters. Do not claim that prospects were found unless another tool provides separate evidence.",

      important_note:
        "These records represent evidence-backed potential prospects. They do not establish buying intent or customer status unless explicitly supported by the stored evidence.",
    };
  },
});

function formatProspect(prospect: Prospect) {
  return {
    id: prospect.id,

    identity: {
      name: prospect.name,
      organization: prospect.organization ?? null,
      role: prospect.role ?? null,
      prospect_type: prospect.prospect_type,
    },

    qualification: {
      status: prospect.qualification_status,
      confidence: prospect.confidence ?? null,
    },

    discovery: {
      website: prospect.website ?? null,
      public_profile_url:
        prospect.public_profile_url ?? null,
    },

    relevance: {
      product_id: prospect.product_id ?? null,
      fit_reason: prospect.fit_reason ?? null,
      opportunity_signal:
        prospect.opportunity_signal ?? null,
    },

    evidence: prospect.evidence,

    unknowns: prospect.unknowns,

    provenance: {
      source_task_id:
        prospect.source_task_id ?? null,

      created_at:
        prospect.created_at,

      updated_at:
        prospect.updated_at,
    },
  };
}