/**
 * Persisted Web Research Results
 * ------------------------------
 *
 * Milestone 3C.
 *
 * This module provides read-only retrieval of completed web-research tasks.
 *
 * IMPORTANT:
 * - It does not perform web searches.
 * - It does not interpret research.
 * - It returns only research that the task engine has persisted.
 * - Missing or malformed persisted research returns null.
 */

import { getDb } from "@/lib/db";

export interface PersistedResearchResult {
  task_id: string;
  task_type: string;
  task_status: string;
  title: string | null;
  description: string | null;
  result_summary: string | null;
  completed_at: string | null;
  result_data: Record<string, unknown>;
}

/**
 * Build progressively broader retrieval candidates from a conversational
 * research query.
 *
 * The Master Agent is instructed to provide the canonical research subject,
 * but this function deliberately remains tolerant of a longer conversational
 * query. This prevents a valid persisted research result from becoming
 * invisible merely because the model supplied too much surrounding wording.
 */
function buildQueryCandidates(query: string): string[] {
  const candidates: string[] = [];

  const add = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    const normalized = trimmed
      .replace(/\s+/g, " ")
      .replace(/[?.!,;]+$/g, "")
      .trim();

    if (
      normalized &&
      !candidates.some(
        (candidate) =>
          candidate.toLowerCase() === normalized.toLowerCase()
      )
    ) {
      candidates.push(normalized);
    }
  };

  const original = query.trim();

  add(original);

  /*
   * First isolate the user's actual question from trailing instructions,
   * which commonly begin after a question mark.
   */
  const beforeQuestion = original.split("?")[0]?.trim();

  if (beforeQuestion) {
    add(beforeQuestion);
  }

  /*
   * Remove common conversational wrappers.
   *
   * Examples:
   *
   * "What did you discover about Patterns of Opportunity?"
   * ->
   * "Patterns of Opportunity"
   *
   * "Tell me what you found about Patterns of Opportunity"
   * ->
   * "Patterns of Opportunity"
   */
  const conversationalPatterns = [
    /^what did you discover about\s+/i,
    /^what did you find about\s+/i,
    /^what did you learn about\s+/i,
    /^what have you discovered about\s+/i,
    /^what have you found about\s+/i,
    /^what do you know about\s+/i,
    /^tell me what you discovered about\s+/i,
    /^tell me what you found about\s+/i,
    /^tell me what you learned about\s+/i,
    /^tell me more about\s+/i,
    /^tell me about\s+/i,
    /^what evidence did you find about\s+/i,
    /^what evidence did you find of\s+/i,
    /^what research did you do about\s+/i,
    /^what research did you conduct about\s+/i,
    /^what did the research discover about\s+/i,
  ];

  for (const pattern of conversationalPatterns) {
    const match = beforeQuestion?.match(pattern);

    if (match) {
      add(beforeQuestion!.slice(match[0].length));
      break;
    }
  }

  /*
   * If the subject includes an author suffix such as:
   *
   * "Patterns of Opportunity: Seeing What Others Overlook by Innocent Mwangi"
   *
   * also try the title without the author.
   */
  const currentCandidates = [...candidates];

  for (const candidate of currentCandidates) {
    const withoutAuthor = candidate.replace(
      /\s+by\s+[A-Z][^,?]+$/i,
      ""
    );

    add(withoutAuthor);

    /*
     * A conversational query may contain a colon followed by a subtitle.
     * Keep the complete title first, but also try the principal title.
     *
     * Example:
     * Patterns of Opportunity: Seeing What Others Overlook
     * ->
     * Patterns of Opportunity
     */
    const colonIndex = withoutAuthor.indexOf(":");

    if (colonIndex > 0) {
      add(withoutAuthor.slice(0, colonIndex));
    }
  }

  return candidates;
}

/**
 * Returns the latest completed web-research task matching the supplied query.
 *
 * Matching is limited to task title, description and result summary.
 * The function first tries the supplied query and then progressively more
 * focused topic candidates derived from conversational wording.
 *
 * We do not search the research body because it may contain large amounts
 * of arbitrary text.
 */
export async function getLatestWebResearchResult(
  query: string
): Promise<PersistedResearchResult | null> {
  const db = await getDb();
  const trimmed = query.trim();

  if (!trimmed) {
    return null;
  }

  const candidates = buildQueryCandidates(trimmed);

  for (const candidate of candidates) {
    const pattern = `%${candidate}%`;

    const result = await db.execute({
      sql: `
        SELECT
          t.id,
          t.task_type,
          t.status,
          t.title,
          t.description,
          t.result_summary,
          t.result_json,
          t.completed_at,
          t.updated_at,
          t.created_at
        FROM agent_tasks t
        WHERE
          LOWER(t.task_type) IN (
            'web_research',
            'web-research',
            'web research'
          )
          AND LOWER(t.status) IN (
            'completed',
            'completed_with_issues'
          )
          AND t.result_json IS NOT NULL
          AND (
            LOWER(COALESCE(t.title, '')) LIKE LOWER(?)
            OR LOWER(COALESCE(t.description, '')) LIKE LOWER(?)
            OR LOWER(COALESCE(t.result_summary, '')) LIKE LOWER(?)
          )
        ORDER BY
          COALESCE(t.completed_at, t.updated_at, t.created_at) DESC
        LIMIT 1
      `,
      args: [pattern, pattern, pattern],
    });

    const row = result.rows[0] as unknown as
      | {
          id: string;
          task_type: string;
          status: string;
          title: string | null;
          description: string | null;
          result_summary: string | null;
          result_json: string | null;
          completed_at: string | null;
          updated_at: string | null;
          created_at: string | null;
        }
      | undefined;

    if (!row?.result_json) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(row.result_json);

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        continue;
      }

      return {
        task_id: row.id,
        task_type: row.task_type,
        task_status: row.status,
        title: row.title,
        description: row.description,
        result_summary: row.result_summary,
        completed_at: row.completed_at,
        result_data: parsed as Record<string, unknown>,
      };
    } catch {
      /*
       * Persisted malformed JSON must never crash the intelligence layer.
       * Continue looking at the next candidate rather than treating a
       * malformed matching row as the end of retrieval.
       */
      continue;
    }
  }

  return null;
}