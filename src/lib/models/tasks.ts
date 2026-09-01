import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
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

export function createTask(input: CreateTaskInput): AgentTask {
  const db = getDb();
  const id = randomUUID();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO agent_tasks (
      id, user_id, parent_task_id, title, description, task_type, status,
      priority, created_at, updated_at, last_activity_at, progress_current,
      progress_total, progress_label, conversation_id, created_by, max_retries
    ) VALUES (
      @id, @user_id, @parent_task_id, @title, @description, @task_type, @status,
      @priority, @created_at, @updated_at, @last_activity_at, 0,
      @progress_total, @progress_label, @conversation_id, @created_by, @max_retries
    )`
  ).run({
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
  });

  return getTaskById(id)!;
}

export function getTaskById(id: string): AgentTask | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM agent_tasks WHERE id = ?`)
    .get(id) as AgentTask | undefined;
  return row ?? null;
}

export function getTaskWithSubtasks(id: string): AgentTaskWithChildren | null {
  const task = getTaskById(id);
  if (!task) return null;
  const subtasks = listSubtasks(id);
  return { ...task, subtasks };
}

export function listSubtasks(parentTaskId: string): AgentTask[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM agent_tasks WHERE parent_task_id = ? ORDER BY created_at ASC`
    )
    .all(parentTaskId) as AgentTask[];
}

export interface ListTasksOptions {
  user_id: string;
  topLevelOnly?: boolean;
  statuses?: TaskStatus[];
  limit?: number;
}

export function listTasks(options: ListTasksOptions): AgentTask[] {
  const db = getDb();
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

  return db
    .prepare(
      `SELECT * FROM agent_tasks WHERE ${clauses.join(
        " AND "
      )} ORDER BY created_at DESC ${limitClause}`
    )
    .all(params) as AgentTask[];
}

/** Tasks that are actively QUEUED or RUNNING — used by the engine each tick. */
export function listActiveTopLevelTasks(): AgentTask[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM agent_tasks
       WHERE parent_task_id IS NULL
       AND status IN ('QUEUED', 'RUNNING')
       ORDER BY created_at ASC`
    )
    .all() as AgentTask[];
}

/**
 * Updates an existing task after validating the requested transition and
 * the fields being written.
 *
 * Field names are runtime-validated against UPDATABLE_TASK_FIELDS before
 * being interpolated into the SQL statement. Values continue to use
 * parameterized SQL bindings.
 */
export function updateTask(
  id: string,
  fields: Partial<AgentTask>
): AgentTask {
  const db = getDb();
  const current = getTaskById(id);

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
    return getTaskById(id)!;
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

  db.prepare(
    `UPDATE agent_tasks
     SET ${setClause}, updated_at = @updated_at
     WHERE id = @id`
  ).run({
    ...params,
    updated_at: nowIso(),
  });

  return getTaskById(id)!;
}

export function touchHeartbeat(id: string): void {
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `UPDATE agent_tasks
     SET last_activity_at = @ts,
         heartbeat_at = @ts,
         updated_at = @ts
     WHERE id = @id`
  ).run({
    ts: timestamp,
    id,
  });
}

/** Atomically claims a queued task, preventing a second worker from running it. */
export function claimTask(
  id: string,
  workerId: string,
  executionId: string
): AgentTask | null {
  const db = getDb();
  const timestamp = nowIso();

  const result = db
    .prepare(`
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
    `)
    .run({
      id,
      workerId,
      executionId,
      ts: timestamp,
    });

  return result.changes === 1 ? getTaskById(id) : null;
}

export function claimSubtask(
  id: string,
  workerId: string,
  executionId: string
): AgentTask | null {
  const db = getDb();
  const timestamp = nowIso();

  const result = db
    .prepare(`
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
    `)
    .run({
      id,
      workerId,
      executionId,
      ts: timestamp,
    });

  return result.changes === 1 ? getTaskById(id) : null;
}

/** Recomputes a parent task's aggregate progress from its subtasks. */
export function recomputeParentProgress(
  parentTaskId: string
): AgentTask {
  const subtasks = listSubtasks(parentTaskId);
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