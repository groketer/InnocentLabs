/**
 * reassign_prospect_to_product tool.
 *
 * MILESTONE 4Y — directly addresses a real, observed gap: the agent could
 * find prospects and identify that they were mismatched with their
 * assigned product, but had no way to actually fix that — only to
 * suggest the human do it manually. Unlike qualification_status
 * (deliberately locked — see instructions.ts), reassignment is safe for
 * the agent to do directly: reassignProspectToProduct() always resets
 * qualification_status to "needs_review", so this can never accidentally
 * trigger outreach to someone who hasn't been freshly evaluated against
 * their new product.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { findProspectsByLooseMatch, reassignProspectToProduct } from "@/lib/models/prospects";
import { getProductByName } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const reassignProspectToProductTool = tool({
  name: "reassign_prospect_to_product",

  description: `
Reassigns an existing prospect to a different Innocent Labs product —
use this when a prospect was found for, or is currently assigned to, one
product but is actually a better fit for a different one.

This is safe to do directly: reassignment always resets the prospect back
to "needs_review" (never "qualified"), so it can never accidentally start
an outreach sequence — the human still makes that call afterward, same as
for any other prospect.

Provide a search term (name, organization, or email) to find the prospect,
and the exact or near-exact name of the product to move them to. If the
search term matches multiple prospects, or the product name doesn't
resolve to exactly one product, nothing is changed and you'll be told why
— narrow the search term or product name and try again rather than
guessing which one was meant.
`,

  parameters: z.object({
    prospectSearchTerm: z
      .string()
      .min(1)
      .describe("Name, organization, or email fragment identifying the one prospect to reassign."),
    targetProductName: z
      .string()
      .min(1)
      .describe('The product to move this prospect to, e.g. "Future Me".'),
  }),

  async execute({ prospectSearchTerm, targetProductName }) {
    const matches = await findProspectsByLooseMatch(LOCAL_USER_ID, prospectSearchTerm);

    if (matches.length === 0) {
      return { success: false, reason: `No prospect found matching "${prospectSearchTerm}".` };
    }
    if (matches.length > 1) {
      return {
        success: false,
        reason: `"${prospectSearchTerm}" matches ${matches.length} prospects — be more specific about which one you mean.`,
        matches: matches.map((p) => ({ name: p.name, organization: p.organization, email: p.email })),
      };
    }

    const targetProduct = await getProductByName(targetProductName);
    if (!targetProduct) {
      return { success: false, reason: `No product found matching "${targetProductName}".` };
    }

    const prospect = matches[0];
    const updated = await reassignProspectToProduct(LOCAL_USER_ID, prospect.id, targetProduct.id);

    return {
      success: true,
      prospectName: updated.name,
      movedFromProductId: prospect.product_id,
      movedToProduct: targetProduct.name,
      newQualificationStatus: updated.qualification_status,
      note: "Qualification status was reset to needs_review — this prospect needs a fresh look before any outreach starts for the new product.",
    };
  },
});
