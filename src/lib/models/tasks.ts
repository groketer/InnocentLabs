/**
 * MILESTONE 3E — VERCEL:
 * Every function here is now async because the underlying Postgres
 * connection (Postgres via @neondatabase/serverless) is async. See src/lib/db.ts.
 * See src/lib/db.ts for why.
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import type { InArgs } from "@/lib/db";
import type {
  AgentTask,
  AgentTaskWithChildren,
  TaskStatus,
} from "@/lib/types";

function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateTaskInput {
  user_id: string;
  parent_task_id?: string | null;
  title: string;
  description?: string | null;
  task_type: string;
  priority?: "low" | "normal" | "high";
  status?: TaskStatus;
  progress_total?: number | null;
  progress_label?: string | null;
  conversation_id?: string | null;
  created_by?: "agent" | "user" | "system";
  max_retries?: number;
}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: [
    "PAUSED",
    "NEEDS_INPUT",
    "COMPLETED",
    "COMPLETED_WITH_ISSUES",
    "FAILED",
    "CANCELLED",
    "RETRYING",
    "QUEUED",
  ],
  PAUSED: ["RUNNING", "CANCELLED"],
  RETRYING: ["RUNNING", "CANCELLED", "FAILED"],
  NEEDS_INPUT: ["RUNNING", "CANCELLED"],
  FAILED: ["QUEUED", "CANCELLED"],
  COMPLETED: ["CANCELLED"],
  COMPLETED_WITH_ISSUES: ["QUEUED", "CANCELLED"],
  CANCELLED: [],
};

/**
 * Runtime allow-list for task fields that may be changed through updateTask().
 *
 * TypeScript's Partial<AgentTask> is useful at compile time, but it is not a
 * runtime security boundary. Since these field names eventually become SQL
 * identifiers, they must be explicitly validated before being interpolated
 * into the UPDATE statement.
 *
 * Immutable identity fields such as id, user_id, and created_at are
 * deliberately excluded.
 */
const UPDATABLE_TASK_FIELDS = new Set<keyof AgentTask>([
  "parent_task_id",
  "title",
  "description",
  "task_type",
  "status",
  "priority",
  "started_at",
  "updated_at",
  "completed_at",
  "paused_at",
  "last_activity_at",
  "next_retry_at",
  "progress_current",
  "progress_total",
  "progress_label",
  "current_step",
  "current_subtask",
  "worker_id",
  "execution_id",
  "heartbeat_at",
  "last_attempt_at",
  "result_summary",
  "result_json",
  "result_reference",
  "error_message",
  "retry_count",
  "max_retries",
  "conversation_id",
  "requires_user_input",
  "input_reason",
  "created_by",
]);

export async function createTask(input: CreateTaskInput): Promise<AgentTask> {
  const db = await getDb();
  const id = randomUUID();
  const timestamp = nowIso();

  await db.execute({
    sql: `INSERT INTO agent_tasks (
      id, user_id, parent_task_id, title, description, task_type, status,
      priority, created_at, updated_at, last_activity_at, progress_current,
      progress_total, progress_label, conversation_id, created_by, max_retries
    ) VALUES (
      @id, @user_id, @parent_task_id, @title, @description, @task_type, @status,
      @priority, @created_at, @updated_at, @last_activity_at, 0,
      @progress_total, @progress_label, @conversation_id, @created_by, @max_retries
    )`,
    args: {
      id,
      user_id: input.user_id,
      parent_task_id: input.parent_task_id ?? null,
      title: input.title,
      description: input.description ?? null,
      task_type: input.task_type,
      status: input.status ?? "QUEUED",
      priority: input.priority ?? "normal",
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
      progress_total: input.progress_total ?? null,
      progress_label: input.progress_label ?? null,
      conversation_id: input.conversation_id ?? null,
      created_by: input.created_by ?? "agent",
      max_retries: input.max_retries ?? 3,
    },
  });

  return (await getTaskById(id))!;
}

export async function getTaskById(id: string): Promise<AgentTask | null> {
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT * FROM agent_tasks WHERE id = ?`,
    args: [id],
  });

  const row = result.rows[0] as unknown as AgentTask | undefined;
  return row ?? null;
}

export async function getTaskWithSubtasks(
  id: string
): Promise<AgentTaskWithChildren | null> {
  const task = await getTaskById(id);
  if (!task) return null;
  const subtasks = await listSubtasks(id);
  return { ...task, subtasks };
}

export async function listSubtasks(parentTaskId: string): Promise<AgentTask[]> {
  const db = await getDb();

  const result = await db.execute({
    sql: `SELECT * FROM agent_tasks WHERE parent_task_id = ? ORDER BY created_at ASC`,
    args: [parentTaskId],
  });

  return result.rows as unknown as AgentTask[];
}

export interface ListTasksOptions {
  user_id: string;
  topLevelOnly?: boolean;
  statuses?: TaskStatus[];
  limit?: number;
}

export async function listTasks(options: ListTasksOptions): Promise<AgentTask[]> {
  const db = await getDb();
  const clauses: string[] = ["user_id = @user_id"];
  const params: Record<string, unknown> = { user_id: options.user_id };

  if (options.topLevelOnly) {
    clauses.push("parent_task_id IS NULL");
  }

  if (options.statuses && options.statuses.length > 0) {
    const placeholders = options.statuses
      .map((_, i) => `@status${i}`)
      .join(", ");
    clauses.push(`status IN (${placeholders})`);
    options.statuses.forEach((s, i) => {
      params[`status${i}`] = s;
    });
  }

  const limitClause = options.limit ? `LIMIT @limit` : "";
  if (options.limit) params.limit = options.limit;

  const result = await db.execute({
    sql: `SELECT * FROM agent_tasks WHERE ${clauses.join(
      " AND "
    )} ORDER BY created_at DESC ${limitClause}`,
    args: params as InArgs,
  });

  return result.rows as unknown as AgentTask[];
}

/** Tasks that are actively QUEUED or RUNNING — used by the engine each tick. */
export async function listActiveTopLevelTasks(): Promise<AgentTask[]> {
  const db = await getDb();

  const result = await db.execute(
    `SELECT * FROM agent_tasks
     WHERE parent_task_id IS NULL
     AND status IN ('QUEUED', 'RUNNING')
     ORDER BY created_at ASC`
  );

  return result.rows as unknown as AgentTask[];
}

/**
 * Updates an existing task after validating the requested transition and
 * the fields being written.
 *
 * Field names are runtime-validated against UPDATABLE_TASK_FIELDS before
 * being interpolated into the SQL statement. Values continue to use
 * parameterized SQL bindings.
 */
export async function updateTask(
  id: string,
  fields: Partial<AgentTask>
): Promise<AgentTask> {
  const db = await getDb();
  const current = await getTaskById(id);

  if (!current) {
    throw new Error(`Task ${id} not found.`);
  }

  if (
    fields.status &&
    fields.status !== current.status &&
    !VALID_TRANSITIONS[current.status].includes(fields.status)
  ) {
    throw new Error(
      `Invalid task transition: ${current.status} → ${fields.status}`
    );
  }

  const entries = Object.entries(fields).filter(([key]) => key !== "id");

  if (entries.length === 0) {
    return (await getTaskById(id))!;
  }

  for (const [key] of entries) {
    if (!UPDATABLE_TASK_FIELDS.has(key as keyof AgentTask)) {
      throw new Error(`Task field "${key}" cannot be updated.`);
    }
  }

  const setClause = entries
    .map(([key]) => `${key} = @${key}`)
    .join(", ");

  const params: Record<string, unknown> = { id };

  for (const [key, value] of entries) {
    params[key] = value;
  }

  await db.execute({
    sql: `UPDATE agent_tasks
     SET ${setClause}, updated_at = @updated_at
     WHERE id = @id`,
    args: {
      ...params,
      updated_at: nowIso(),
    },
  });

  return (await getTaskById(id))!;
}

export async function touchHeartbeat(id: string): Promise<void> {
  const db = await getDb();
  const timestamp = nowIso();

  await db.execute({
    sql: `UPDATE agent_tasks
     SET last_activity_at = @ts,
         heartbeat_at = @ts,
         updated_at = @ts
     WHERE id = @id`,
    args: {
      ts: timestamp,
      id,
    },
  });
}

/** Atomically claims a queued task, preventing a second worker from running it. */
export async function claimTask(
  id: string,
  workerId: string,
  executionId: string
): Promise<AgentTask | null> {
  const db = await getDb();
  const timestamp = nowIso();

  const result = await db.execute({
    sql: `
      UPDATE agent_tasks
      SET status = 'RUNNING',
          worker_id = @workerId,
          execution_id = @executionId,
          started_at = COALESCE(started_at, @ts),
          last_attempt_at = @ts,
          last_activity_at = @ts,
          heartbeat_at = @ts,
          updated_at = @ts
      WHERE id = @id
        AND status = 'QUEUED'
    `,
    args: {
      id,
      workerId,
      executionId,
      ts: timestamp,
    },
  });

  return result.rowsAffected === 1 ? getTaskById(id) : null;
}

export async function claimSubtask(
  id: string,
  workerId: string,
  executionId: string
): Promise<AgentTask | null> {
  const db = await getDb();
  const timestamp = nowIso();

  const result = await db.execute({
    sql: `
      UPDATE agent_tasks
      SET status = 'RUNNING',
          worker_id = @workerId,
          execution_id = @executionId,
          started_at = COALESCE(started_at, @ts),
          last_attempt_at = @ts,
          last_activity_at = @ts,
          heartbeat_at = @ts,
          updated_at = @ts,
          next_retry_at = NULL
      WHERE id = @id
        AND status IN ('QUEUED', 'RETRYING')
    `,
    args: {
      id,
      workerId,
      executionId,
      ts: timestamp,
    },
  });

  return result.rowsAffected === 1 ? getTaskById(id) : null;
}

/** Recomputes a parent task's aggregate progress from its subtasks. */
export async function recomputeParentProgress(
  parentTaskId: string
): Promise<AgentTask> {
  const subtasks = await listSubtasks(parentTaskId);
  const total = subtasks.length;

  const completed = subtasks.filter(
    (s) => s.status === "COMPLETED" || s.status === "FAILED"
  ).length;

  const inProgress = subtasks.find(
    (s) => s.status === "RUNNING" || s.status === "RETRYING"
  );

  return updateTask(parentTaskId, {
    progress_current: completed,
    progress_total: total,
    current_subtask: inProgress ? inProgress.title : null,
    last_activity_at: nowIso(),
  });
}

export const nowIsoString = nowIso;
