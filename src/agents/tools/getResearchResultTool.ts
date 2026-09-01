/**
 * Persisted Research Retrieval Tool
 * ----------------------------------
 *
 * Milestone 3C.
 *
 * This tool retrieves completed research from the task engine.
 *
 * It does NOT perform live web research.
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  getLatestWebResearchResult,
} from "@/lib/taskEngine/researchResults";

export const getResearchResultTool = tool({
  name: "get_research_result",

  description: `
Retrieve completed web research that Innocent Intelligence previously
persisted through the background task engine.

USE THIS TOOL when Innocent asks what the system discovered, found, learned,
or established from a previous research task.

This tool is READ-ONLY.

It does NOT:
- perform a new web search;
- create a new task;
- modify persisted research;
- invent missing research.

QUERY RULES:

1. Prefer the canonical subject of the research as the query.
2. Do NOT pass the entire conversational question when a shorter distinctive
   subject is available.
3. For example, if Innocent asks:
   "What did you discover about the actual content and positioning of
   Patterns of Opportunity: Seeing What Others Overlook by Innocent Mwangi?"

   prefer:
   "Patterns of Opportunity"

   or:
   "Patterns of Opportunity: Seeing What Others Overlook"

4. The retrieval layer can also tolerate a longer conversational query, but
   canonical topic extraction is preferred.

IMPORTANT:

- A failed lookup means that this retrieval attempt found no matching
  persisted research. It does NOT mean that the research task never existed.
- Do not claim that external research was completed unless this tool returns
  a completed persisted result.
- When this tool returns a result, use that persisted research as the primary
  source for questions about what the previous research discovered.
- Do not perform a new web search merely because the user asks a follow-up
  question about an already completed research task.
- Distinguish source-backed findings from interpretation.
- Preserve uncertainty and evidence gaps contained in the persisted research.
- Do not upgrade research findings into verified Innocent Labs portfolio facts.
`,

  parameters: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'The distinctive subject of the previous research, preferably the canonical topic or title, e.g. "Patterns of Opportunity".'
      ),
  }),

  execute: async ({ query }) => {
    const requested = query.trim();

    const result = getLatestWebResearchResult(requested);

    if (!result) {
      return JSON.stringify({
        found: false,

        query: requested,

        message:
          "No completed persisted web research matching that topic was found.",
      });
    }

    return JSON.stringify({
      found: true,

      query: requested,

      research: result,
    });
  },
});