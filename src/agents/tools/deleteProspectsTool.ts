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

CRITICAL — report the actual result accurately, not an assumption of
success: check deleted_count, not_found, and failed in the response.
This has gone wrong before: a search term that matched nothing was
reported to Innocent as a successful deletion, when in fact nothing was
found or removed. If a name appears in not_found, say plainly that no
matching record was found — do not describe it as deleted. If anything
appears in failed, report the specific reason given.
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
    const failed: string[] = [];

    for (const term of searchTerms) {
      const matches = await findProspectsByLooseMatch(LOCAL_USER_ID, term);
      if (matches.length === 0) {
        notFound.push(term);
        continue;
      }
      for (const match of matches) {
        try {
          await deleteProspect(LOCAL_USER_ID, match.id);
          // MILESTONE 4F — a real bug this fixes: this tool previously
          // always returned a top-level "success: true" regardless of
          // whether anything actually matched and got deleted, with the
          // real outcome tucked into deleted_count/not_found instead.
          // That's genuinely ambiguous, and led to a real incident: a
          // search term that matched nothing was reported to Innocent
          // as a successful deletion. Verifying the prospect is
          // actually gone, and removing any single misleading success
          // flag, closes that gap.
          const stillExists = await findProspectsByLooseMatch(LOCAL_USER_ID, match.name);
          if (stillExists.some((p) => p.id === match.id)) {
            failed.push(`${match.name} — delete call completed but the record still exists`);
            continue;
          }
          deleted.push(`${match.name}${match.organization ? ` (${match.organization})` : ""}`);
        } catch (error) {
          failed.push(`${match.name} — ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }

    return {
      deleted_count: deleted.length,
      deleted,
      not_found: notFound,
      failed,
      instruction:
        "Report deleted_count and the actual deleted/not_found/failed lists accurately — do not describe this as fully successful if not_found or failed is non-empty. If something is in not_found, say plainly that no matching record was found for that search term, rather than assuming it was deleted.",
    };
  },
});
