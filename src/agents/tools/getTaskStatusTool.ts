/**
 * get_task_status tool.
 *
 * MILESTONE 5S — a real, observed gap this closes: throughout an entire
 * investigation this session, the agent's task-related answers were
 * consistently vague — "I will monitor its progress and notify you",
 * "this might be a caching issue", "let me check on that" — when the
 * actual, concrete answer (a specific subtask stuck retrying, a named
 * error message, a task genuinely still queued behind others) was
 * sitting right there in the database the whole time, one query away.
 * get_activity_summary gives a high-level event feed; this gives deep,
 * structured visibility into ONE specific task's real state: its
 * subtask breakdown, the actual error_message on every failed subtask
 * (not a paraphrase), and a computed stuck-detection heuristic so the
 * agent can say "this has been running for 6 hours with no subtask
 * progress in the last 2 — that's stuck" instead of "it's running".
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type { AgentTask } from "@/lib/types";

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes with no activity

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function summarizeTask(task: AgentTask, subtasks: AgentTask[]) {
  const byStatus: Record<string, number> = {};
  for (const s of subtasks) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }

  const failedSubtasks = subtasks
    .filter((s) => s.status === "FAILED")
    .map((s) => ({ title: s.title, error_message: s.error_message, failed_at: s.updated_at }));

  const lastActivityMinutesAgo = minutesAgo(task.last_activity_at ?? task.updated_at);
  const isActive = task.status === "RUNNING" || task.status === "QUEUED";
  const likelyStuck =
    isActive &&
    lastActivityMinutesAgo !== null &&
    lastActivityMinutesAgo * 60000 > STUCK_THRESHOLD_MS;

  return {
    id: task.id,
    title: task.title,
    task_type: task.task_type,
    status: task.status,
    error_message: task.error_message,
    result_summary: task.result_summary,
    created_minutes_ago: minutesAgo(task.created_at),
    last_activity_minutes_ago: lastActivityMinutesAgo,
    completed_at: task.completed_at,
    requires_user_input: task.requires_user_input === 1,
    input_reason: task.input_reason,
    subtask_count: subtasks.length,
    subtasks_by_status: byStatus,
    failed_subtasks: failedSubtasks,
    likely_stuck: likelyStuck,
    stuck_explanation: likelyStuck
      ? `Status is ${task.status} but nothing has happened in ${lastActivityMinutesAgo} minutes — this looks genuinely stuck, not just slow.`
      : null,
  };
}

export const getTaskStatusTool = tool({
  name: "get_task_status",

  description: `
Retrieve the real, current, detailed state of a specific task — read
live from the database. Use this whenever Innocent asks about a
specific task's progress, whether something is stuck, why something
failed, or what's actually happening with a named task ("the book
prospecting task", "the daily campaign", "that prospecting run from
this morning").

Returns, per matching task: its real status, how long it's been
running, a full breakdown of its subtasks by status, the ACTUAL
error_message for every failed subtask (never paraphrase or guess at
why something failed — quote what this tool returns), and whether it
looks genuinely stuck (active but no progress in over 30 minutes) as
opposed to just legitimately still working.

Search by keyword (matches task titles) to find a task by what it's
about, or pass task_type to find the most recent task of a given kind
(e.g. "web_prospecting", "email_campaign", "portfolio_refresh",
"deep_qualification", "website_audit", "product_study"). If a search
matches more than one task, all matches are returned, most recent
first — report on whichever the person actually means, or ask if it's
ambiguous, rather than guessing which one.

Never respond to a "is X stuck / what's happening with X" question with
a vague answer like "I'll monitor it" when this tool can give you the
real, current, specific answer directly.
`,

  parameters: z.object({
    searchTerm: z
      .string()
      .optional()
      .describe('Keyword to match against task titles, e.g. "Patterns of Opportunity" or "daily outreach".'),
    taskType: z
      .string()
      .optional()
      .describe('Task type to find the most recent task of, e.g. "web_prospecting".'),
    limit: z.number().min(1).max(10).optional().describe("Max tasks to return. Defaults to 5."),
  }),

  async execute({ searchTerm, taskType, limit }) {
    if (!searchTerm && !taskType) {
      return { success: false, reason: "Provide a searchTerm (keyword) or a taskType to look up." };
    }

    const db = await getDb();
    const conditions = ["user_id = @user_id", "parent_task_id IS NULL"];
    const args: Record<string, unknown> = { user_id: LOCAL_USER_ID };

    if (searchTerm) {
      conditions.push("title ILIKE @search");
      args.search = `%${searchTerm}%`;
    }
    if (taskType) {
      conditions.push("task_type = @task_type");
      args.task_type = taskType;
    }

    const effectiveLimit = Math.min(Math.max(limit ?? 5, 1), 10);

    const result = await db.execute({
      sql: `
        SELECT * FROM agent_tasks
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT @limit
      `,
      args: { ...args, limit: effectiveLimit },
    });

    const tasks = result.rows as unknown as AgentTask[];

    if (tasks.length === 0) {
      return {
        success: true,
        matchCount: 0,
        tasks: [],
        note: "No matching task found — double check the name, or it may be older than what's kept, or genuinely never existed.",
      };
    }

    const withSubtasks = await Promise.all(
      tasks.map(async (task) => {
        const subResult = await db.execute({
          sql: `SELECT * FROM agent_tasks WHERE parent_task_id = @id ORDER BY created_at ASC`,
          args: { id: task.id },
        });
        return summarizeTask(task, subResult.rows as unknown as AgentTask[]);
      })
    );

    return {
      success: true,
      matchCount: withSubtasks.length,
      tasks: withSubtasks,
      source: "Live query against agent_tasks, just now.",
    };
  },
});
