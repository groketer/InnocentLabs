/**
 * search_product_documents tool.
 *
 * MILESTONE 3W — platform-wide reasoning audit.
 *
 * The email composer already searches uploaded product documents (a
 * book, a spec sheet) for passages relevant to a specific prospect — but
 * the chat agent had no equivalent, so asked "what's in the knowledge
 * base for X" or "find the chapter about Y", it had nothing to check.
 * Same underlying search as the composer uses, exposed here too.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { searchProductKnowledge } from "@/lib/models/productDocuments";
import { getProductByName } from "@/lib/models/products";

export const searchProductDocumentsTool = tool({
  name: "search_product_documents",

  description: `
Search a specific product's uploaded reference documents (e.g. a book,
a spec sheet) for passages matching a query — read live from what's
actually been uploaded via that product's Knowledge base panel.

Use this when Innocent asks what's in a product's knowledge base, or
asks you to find or reference specific content from an uploaded
document. If nothing has been uploaded for that product, or nothing
matches, say so plainly rather than inventing content.
`,

  parameters: z.object({
    product_name: z.string().min(1).describe('Exact or near-exact product name, e.g. "Patterns of Opportunity".'),
    query: z.string().min(1).describe("A few words describing what to search for."),
  }),

  async execute({ product_name, query }) {
    const product = await getProductByName(product_name.trim());

    if (!product) {
      return {
        success: false,
        message: `No product named "${product_name}" exists in the portfolio.`,
      };
    }

    const results = await searchProductKnowledge(product.id, query, 3);

    if (results.length === 0) {
      return {
        success: true,
        found: false,
        message: "No matching passages — either nothing is uploaded for this product yet, or nothing matches this query closely enough.",
      };
    }

    return {
      success: true,
      found: true,
      passages: results.map((r) => ({ source: r.filename, text: r.chunk_text })),
    };
  },
});
