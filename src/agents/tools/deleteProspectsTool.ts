/**
 * delete_prospects tool.
 *
 * MILESTONE 4E — lets the chat agent actually remove prospects from the
 * pipeline when explicitly instructed, rather than only being able to
 * discuss/flag them. This is a real, destructive database action —
 * only ever call it when Innocent has clearly asked for prospects to be
 * removed, not as a routine part of answering a question about them.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { findProspectsByLooseMatch, deleteProspect } from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const deleteProspectsTool = tool({
  name: "delete_prospects",

  description: `
Permanently delete one or more prospects from the pipeline. This is a
real, destructive action — only call this when Innocent has explicitly
asked for prospects to be removed or deleted, not merely discussed or
flagged.

Provide search terms (name, organization, or email) for each prospect to
delete — matching is loose/partial, so "Groketer" would match any
prospect with that in their name, organization, or email. If a search
term matches multiple prospects, ALL matches are deleted — so be precise
enough in the search terms that you're confident about what will be
removed. If you're not confident which prospects Innocent means, use
get_prospects first to check rather than guessing.
`,

  parameters: z.object({
    searchTerms: z
      .array(z.string().min(1))
      .min(1)
      .describe("One search term per prospect (or group) to delete — name, organization, or email fragment."),
  }),

  async execute({ searchTerms }) {
    const deleted: string[] = [];
    const notFound: string[] = [];

    for (const term of searchTerms) {
      const matches = await findProspectsByLooseMatch(LOCAL_USER_ID, term);
      if (matches.length === 0) {
        notFound.push(term);
        continue;
      }
      for (const match of matches) {
        await deleteProspect(LOCAL_USER_ID, match.id);
        deleted.push(`${match.name}${match.organization ? ` (${match.organization})` : ""}`);
      }
    }

    return {
      success: true,
      deleted_count: deleted.length,
      deleted,
      not_found: notFound,
    };
  },
});
