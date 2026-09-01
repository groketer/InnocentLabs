import { getDb } from "@/lib/db";
import {
  getTaskById,
  listSubtasks,
  updateTask,
} from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import type { AgentTask } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

export class TaskActionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireOwnedTask(id: string, userId: string): AgentTask {
  const task = getTaskById(id);

  if (!task) {
    throw new TaskActionError("Task not found.", 404);
  }

  if (task.user_id !== userId) {
    throw new TaskActionError("You don't have access to this task.", 403);
  }

  return task;
}

export function pauseTask(id: string, userId: string): AgentTask {
  const task = requireOwnedTask(id, userId);

  /*
   * The authoritative task state machine permits RUNNING → PAUSED.
   * QUEUED → PAUSED is not a valid transition, so do not advertise
   * queued tasks as pausable here.
   */
  if (task.status !== "RUNNING") {
    throw new TaskActionError(
      `Cannot pause a task in status ${task.status}.`
    );
  }

  const updated = updateTask(id, {
    status: "PAUSED",
    paused_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
  });

  logActivity({
    user_id: userId,
    task_id: id,
    event_type: "TASK_PAUSED",
    message: `${task.title}: paused by user.`,
  });

  return updated;
}

export function resumeTask(id: string, userId: string): AgentTask {
  const task = requireOwnedTask(id, userId);

  if (task.status !== "PAUSED" && task.status !== "NEEDS_INPUT") {
    throw new TaskActionError(
      `Cannot resume a task in status ${task.status}.`
    );
  }

  /*
   * If this task was left in NEEDS_INPUT by the crash-recovery pass,
   * subtasks were already reset to QUEUED at that time — resuming just
   * means "go ahead and continue."
   */
  const updated = updateTask(id, {
    status: "RUNNING",
    requires_user_input: 0,
    paused_at: null,
    last_activity_at: nowIso(),
  });

  logActivity({
    user_id: userId,
    task_id: id,
    event_type: "TASK_RESUMED",
    message: `${task.title}: resumed.`,
  });

  return updated;
}

export function retryTask(id: string, userId: string): AgentTask {
  const task = requireOwnedTask(id, userId);

  const subtasks = listSubtasks(id);
  const failedSubtasks = subtasks.filter(
    (s) => s.status === "FAILED"
  );

  const retryableAsWhole =
    task.status === "FAILED" && subtasks.length === 0;

  const retryableFailedItems = failedSubtasks.length > 0;

  if (!retryableAsWhole && !retryableFailedItems) {
    throw new TaskActionError(
      task.status === "FAILED" || task.status === "COMPLETED"
        ? "This task has no failed items left to retry."
        : `Cannot retry a task in status ${task.status}.`
    );
  }

  const db = getDb();

  const resetSubtasks = db.transaction((rows: AgentTask[]) => {
    for (const s of rows) {
      updateTask(s.id, {
        status: "QUEUED",
        retry_count: 0,
        error_message: null,
        next_retry_at: null,
        completed_at: null,
        worker_id: null,
        execution_id: null,
        heartbeat_at: null,
        last_attempt_at: null,
      });
    }
  });

  resetSubtasks(failedSubtasks);

  const updated = updateTask(id, {
    status: "QUEUED",
    error_message: null,
    completed_at: null,
    last_activity_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
    last_attempt_at: null,
  });

  logActivity({
    user_id: userId,
    task_id: id,
    event_type: "TASK_RETRYING",
    message:
      subtasks.length > 0
        ? `${task.title}: retrying ${failedSubtasks.length} failed item(s).`
        : `${task.title}: retrying.`,
  });

  return updated;
}

export function cancelTask(id: string, userId: string): AgentTask {
  const task = requireOwnedTask(id, userId);

  if (
    [
      "COMPLETED",
      "FAILED",
      "COMPLETED_WITH_ISSUES",
      "CANCELLED",
    ].includes(task.status)
  ) {
    throw new TaskActionError(
      `Cannot cancel a task that is already ${task.status}.`
    );
  }

  const subtasks = listSubtasks(id);
  const db = getDb();

  const cancelChildren = db.transaction((rows: AgentTask[]) => {
    for (const s of rows) {
      if (
        !["COMPLETED", "FAILED", "CANCELLED"].includes(
          s.status
        )
      ) {
        updateTask(s.id, {
          status: "CANCELLED",
          completed_at: nowIso(),
          worker_id: null,
          execution_id: null,
          heartbeat_at: null,
        });
      }
    }
  });

  cancelChildren(subtasks);

  const updated = updateTask(id, {
    status: "CANCELLED",
    completed_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
  });

  logActivity({
    user_id: userId,
    task_id: id,
    event_type: "TASK_CANCELLED",
    message: `${task.title}: cancelled by user.`,
  });

  return updated;
}