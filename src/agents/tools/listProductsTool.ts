/**
 * list_products tool.
 *
 * MILESTONE 3W — a real, structural gap this closes.
 *
 * The chat agent had no tool for "what products do we have" or "how many
 * products exist" — only get_product_intelligence, which requires an
 * exact name and looks up ONE product. With nothing else to draw on for
 * a portfolio-wide question, the agent fell back to the static
 * /knowledge/products.md file — background context written once, early
 * in this project, and never updated since. It was stuck at 18 products
 * because two more were added to the live database afterward and that
 * file was never touched again. This tool gives the agent the actual,
 * current list, live from the database, every time — and the system
 * instructions now say explicitly to use it instead of the static file
 * for anything portfolio-wide.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { listProducts } from "@/lib/models/products";

export const listProductsTool = tool({
  name: "list_products",

  description: `
Retrieve the complete, CURRENT list of everything in the portfolio,
read directly from the database right now — not from memory, not from
any background knowledge file, which can and does go out of date the
moment a product is added or removed and nobody updates it by hand.

ALWAYS use this tool for any question about the portfolio as a whole —
"how many products do we have", "what products exist", "list our
products", "did we add anything new" — rather than answering from
anything said earlier in this conversation or from general background
knowledge. This has gone wrong before: asked how many products existed,
the answer given was stale by two products because it came from a
knowledge file instead of checking. Never let that happen again.

The result includes every record, labeled by asset_type ("product" vs
"hub" — a hub is internal/organizational, like the marketplace's own
listing page, not something to count as a sellable product) and by
status (active vs discontinued/historical). When summarizing a count for
Innocent, use good judgment about what he actually means — usually
active, non-hub products — but you have the full picture here to reason
from either way.
`,

  parameters: z.object({}),

  async execute() {
    const products = await listProducts();

    return {
      success: true,
      total_records: products.length,
      products: products.map((p) => ({
        name: p.name,
        category: p.category,
        asset_type: p.asset_type,
        status: p.status,
        approval_status: p.approval_status,
        url: p.url,
      })),
      source: "Live query against the products table, just now.",
      note: "This is the current, authoritative list — not the static /knowledge/products.md file, which is background context only and can be out of date.",
    };
  },
});
