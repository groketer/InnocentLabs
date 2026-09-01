/**
 * The task engine.
 *
 * HOW AUTONOMOUS EXECUTION ACTUALLY WORKS HERE (read this before assuming
 * more than what's true):
 *
 * This app runs on localhost as one long-lived Node.js process (started by
 * `next dev` or `next start`). This module starts a `setInterval` loop
 * inside that same process the first time the server boots. Every tick,
 * it looks at QUEUED/RUNNING tasks in the SQLite database and advances
 * each one by exactly one real unit of work (e.g. one website fetch),
 * persisting the result before the next tick. Because the state lives in
 * SQLite and not in the browser, a task keeps progressing even if you
 * close the tab, navigate away, or refresh — as long as this Node process
 * keeps running.
 *
 * This is NOT the same as a durable background job system. If you stop the
 * `next dev`/`next start` process, execution stops — there is no separate
 * worker or queue service running independently. On restart, the engine
 * runs a recovery pass (see `recoverInterruptedTasks`) that finds tasks
 * left mid-flight and marks them for review rather than silently resuming
 * or silently discarding them.
 *
 * If this app is ever deployed to a serverless platform (e.g. Vercel),
 * this exact mechanism will NOT work, because serverless functions don't
 * keep a process alive between requests. At that point this loop would
 * need to be replaced with a scheduled trigger (e.g. Vercel Cron calling
 * a `/api/tasks/tick` route on an interval) driving the same `tick()`
 * function below — the task/activity data model does not need to change.
 */

import { startPortfolioScheduler } from "./portfolioScheduler";
import {
  listActiveTopLevelTasks,
  listSubtasks,
  getTaskById,
  updateTask,
  recomputeParentProgress,
  createTask,
  claimTask,
  claimSubtask,
  touchHeartbeat,
} from "@/lib/models/tasks";
import { randomUUID } from "crypto";
import { logActivity } from "@/lib/models/activity";
import { getDb } from "@/lib/db";
import { getExecutor } from "./registry";
import type { AgentTask } from "@/lib/types";

const TICK_INTERVAL_MS = 4000;
export const STALE_HEARTBEAT_MS = 20000; // used by the UI to flag "possibly stalled"
const RETRY_BASE_DELAY_MS = 15000;
const WORKER_ID = `process-${process.pid}`;

declare global {
  // eslint-disable-next-line no-var
  var __innocentIntelligenceEngineStarted: boolean | undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function backoffDelayMs(retryCount: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1), 2 * 60 * 1000);
}

function errorMessageFromUnknown(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown executor error";
}

/**
 * Persist a failure that occurred outside the normal StepResult contract.
 *
 * Executor exceptions are different from an ordinary unsuccessful result:
 * the executor did not get a chance to return structured output. We record
 * that distinction explicitly and, for a subtask, fail only that subtask so
 * the parent can still account for the other work it may have completed.
 */
function recordExecutorFailure(
  task: AgentTask,
  message: string,
  options?: {
    subtask?: AgentTask;
    retryable?: boolean;
  }
): void {
  const subtask = options?.subtask;

  if (subtask) {
    updateTask(subtask.id, {
      status: "FAILED",
      completed_at: nowIso(),
      error_message: `Executor error: ${message}`,
      last_activity_at: nowIso(),
      current_step: null,
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });

    logActivity({
      user_id: task.user_id,
      task_id: subtask.id,
      event_type: "SUBTASK_FAILED",
      message: `${subtask.title}: executor error — ${message}`,
    });

    recomputeParentProgress(task.id);
    return;
  }

  updateTask(task.id, {
    status: "FAILED",
    completed_at: nowIso(),
    error_message: `Executor error: ${message}`,
    last_activity_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
  });

  logActivity({
    user_id: task.user_id,
    task_id: task.id,
    event_type: "TASK_FAILED",
    message: `${task.title}: executor error — ${message}`,
  });
}

async function startTask(task: AgentTask): Promise<void> {
  const executor = getExecutor(task.task_type);

  if (!executor) {
    updateTask(task.id, {
      status: "FAILED",
      error_message: `No executor registered for task_type "${task.task_type}".`,
      completed_at: nowIso(),
    });
    logActivity({
      user_id: task.user_id,
      task_id: task.id,
      event_type: "TASK_FAILED",
      message: `Task could not start — no executor is registered for "${task.task_type}".`,
    });
    return;
  }

  const claimed = claimTask(task.id, WORKER_ID, randomUUID());
  if (!claimed) return;
  task = claimed;
  logActivity({
    user_id: task.user_id,
    task_id: task.id,
    event_type: "TASK_STARTED",
    message: `Started: ${task.title}`,
  });

  if (executor.planSubtasks) {
    let plan;

    try {
      plan = await executor.planSubtasks(task);
      touchHeartbeat(task.id);
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      recordExecutorFailure(task, message);
      return;
    }

    if (plan.length === 0) {
      updateTask(task.id, {
        status: "COMPLETED",
        completed_at: nowIso(),
        progress_current: 0,
        progress_total: 0,
        result_summary:
          "Nothing to do — no eligible items were found in the underlying data.",
        worker_id: null,
        execution_id: null,
        heartbeat_at: null,
      });
      logActivity({
        user_id: task.user_id,
        task_id: task.id,
        event_type: "TASK_COMPLETED",
        message: `${task.title}: nothing to do (no eligible items found).`,
      });
      return;
    }

    for (const item of plan) {
      createTask({
        user_id: task.user_id,
        parent_task_id: task.id,
        title: item.title,
        description: item.description ?? null,
        task_type: task.task_type,
        status: "QUEUED",
        created_by: "system",
        max_retries: task.max_retries,
      });
    }

    recomputeParentProgress(task.id);
    return;
  }

  if (executor.runTask) {
    try {
      const result = await executor.runTask(task);
      touchHeartbeat(task.id);
      finishSimpleTask(task, result);
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      recordExecutorFailure(task, message);
    }
  }
}

function finishSimpleTask(
  task: AgentTask,
  result: {
    success: boolean;
    summary: string;
    needsInput?: boolean;
    needsInputMessage?: string;
    resultData?: Record<string, unknown>;
  }
): void {
  if (result.needsInput) {
    updateTask(task.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      error_message: result.needsInputMessage ?? null,
      last_activity_at: nowIso(),
    });
    logActivity({
      user_id: task.user_id,
      task_id: task.id,
      event_type: "TASK_NEEDS_INPUT",
      message: result.needsInputMessage ?? "This task needs your input to continue.",
    });
    return;
  }

  updateTask(task.id, {
    status: result.success ? "COMPLETED" : "FAILED",
    completed_at: nowIso(),
    result_summary: result.summary,
    result_json: result.resultData ? JSON.stringify(result.resultData) : null,
    error_message: result.success ? null : result.summary,
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
    last_activity_at: nowIso(),
  });
  logActivity({
    user_id: task.user_id,
    task_id: task.id,
    event_type: result.success ? "TASK_COMPLETED" : "TASK_FAILED",
    message: `${task.title}: ${result.summary}`,
  });
}

async function advanceRunningTask(task: AgentTask): Promise<void> {
  const executor = getExecutor(task.task_type);
  if (!executor) return; // already handled at start

  const subtasks = listSubtasks(task.id);

  if (subtasks.length === 0 && executor.runTask) {
    // simple task, already ran at start; nothing further to do here
    return;
  }

  const now = Date.now();
  const next = subtasks.find(
    (s) =>
      s.status === "QUEUED" ||
      (s.status === "RETRYING" &&
        (!s.next_retry_at || new Date(s.next_retry_at).getTime() <= now))
  );

  if (next) {
    await runSubtaskStep(task, next);
    return;
  }

  const allTerminal = subtasks.every(
    (s) => s.status === "COMPLETED" || s.status === "FAILED"
  );

  if (allTerminal && subtasks.length > 0) {
    const succeeded = subtasks.filter((s) => s.status === "COMPLETED").length;
    const failed = subtasks.filter((s) => s.status === "FAILED").length;
    const summary =
      failed === 0
        ? `Completed. ${succeeded} of ${subtasks.length} items succeeded.`
        : `Completed with issues. ${succeeded} of ${subtasks.length} succeeded, ${failed} failed.`;

    updateTask(task.id, {
      status: failed === 0 ? "COMPLETED" : "COMPLETED_WITH_ISSUES",
      completed_at: nowIso(),
      result_summary: summary,
      current_subtask: null,
      current_step: null,
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
      last_activity_at: nowIso(),
    });
    logActivity({
      user_id: task.user_id,
      task_id: task.id,
      event_type: failed === 0 ? "TASK_COMPLETED" : "TASK_COMPLETED_WITH_ISSUES",
      message: `${task.title}: ${summary}`,
    });
  }
}

async function runSubtaskStep(parent: AgentTask, subtask: AgentTask): Promise<void> {
  const executor = getExecutor(parent.task_type);
  if (!executor?.runSubtask) return;

  const isRetry = subtask.status === "RETRYING";

  const claimed = claimSubtask(subtask.id, WORKER_ID, randomUUID());
  if (!claimed) return;
  subtask = claimed;
  updateTask(subtask.id, {
    current_step: isRetry ? `Retrying (attempt ${subtask.retry_count + 1})` : "In progress",
  });
  updateTask(parent.id, {
    current_subtask: subtask.title,
    current_step: isRetry ? "Retrying a previous failure" : "Auditing",
    last_activity_at: nowIso(),
  });

  logActivity({
    user_id: parent.user_id,
    task_id: subtask.id,
    event_type: "SUBTASK_STARTED",
    message: `${isRetry ? "Retrying" : "Starting"}: ${subtask.title}`,
  });

  let result;
  try {
    result = await executor.runSubtask(parent, subtask);
    touchHeartbeat(parent.id);
    touchHeartbeat(subtask.id);
  } catch (err) {
    touchHeartbeat(parent.id);
    const message = errorMessageFromUnknown(err);
    recordExecutorFailure(parent, message, { subtask });
    return;
  }

  if (result.success) {
    updateTask(subtask.id, {
      status: "COMPLETED",
      completed_at: nowIso(),
      result_summary: result.summary,
      result_json: result.resultData ? JSON.stringify(result.resultData) : null,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    logActivity({
      user_id: parent.user_id,
      task_id: subtask.id,
      event_type: "SUBTASK_COMPLETED",
      message: `${subtask.title}: ${result.summary}`,
    });
    recomputeParentProgress(parent.id);
    return;
  }

  if (result.needsInput) {
    updateTask(subtask.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      error_message: result.needsInputMessage ?? result.errorMessage ?? null,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    updateTask(parent.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    logActivity({
      user_id: parent.user_id,
      task_id: subtask.id,
      event_type: "TASK_NEEDS_INPUT",
      message: `${subtask.title}: ${result.needsInputMessage ?? "needs your input."}`,
    });
    return;
  }

  const nextRetryCount = subtask.retry_count + 1;

  if (result.transientFailure && nextRetryCount <= subtask.max_retries) {
    const delay = backoffDelayMs(nextRetryCount);
    updateTask(subtask.id, {
      status: "RETRYING",
      retry_count: nextRetryCount,
      next_retry_at: new Date(Date.now() + delay).toISOString(),
      error_message: result.errorMessage ?? result.summary,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    logActivity({
      user_id: parent.user_id,
      task_id: subtask.id,
      event_type: "TASK_RETRYING",
      message: `${subtask.title}: ${result.summary} — will retry (attempt ${nextRetryCount} of ${subtask.max_retries}).`,
    });
    return;
  }

  updateTask(subtask.id, {
    status: "FAILED",
    completed_at: nowIso(),
    retry_count: nextRetryCount,
    error_message: result.errorMessage ?? result.summary,
    last_activity_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
  });
  logActivity({
    user_id: parent.user_id,
    task_id: subtask.id,
    event_type: "SUBTASK_FAILED",
    message: `${subtask.title}: ${result.summary}${
      result.transientFailure ? " (gave up after max retries)" : ""
    }`,
  });
  recomputeParentProgress(parent.id);
}

/** One tick: advance every active top-level task by exactly one real step each. */
export async function tick(): Promise<void> {
  const tasks = listActiveTopLevelTasks();

  for (const task of tasks) {
    try {
      if (task.status === "QUEUED") {
        await startTask(task);
      } else if (task.status === "RUNNING") {
        await advanceRunningTask(task);
      }
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      console.error(`[taskEngine] Tick error on task ${task.id}:`, err);
      updateTask(task.id, {
        status: "FAILED",
        completed_at: nowIso(),
        error_message: `Unexpected engine error: ${message}`,
        worker_id: null,
        execution_id: null,
        heartbeat_at: null,
        last_activity_at: nowIso(),
      });
      logActivity({
        user_id: task.user_id,
        task_id: task.id,
        event_type: "TASK_FAILED",
        message: `${task.title} failed due to an unexpected engine error.`,
      });
    }
  }
}

/**
 * Runs once at process start. Any task/subtask still marked RUNNING at
 * this point could not have been ticked by *this* process — it must be
 * left over from a previous process that stopped (crash, manual stop,
 * dev-server restart). We don't silently resume or silently discard it:
 * subtasks are reset to QUEUED (safe — they'll simply be retried), and
 * the parent task is moved to NEEDS_INPUT so a person decides whether to
 * resume.
 */
export function recoverInterruptedTasks(): void {
  const db = getDb();
  const staleSubtasks = db
    .prepare(`SELECT * FROM agent_tasks WHERE status = 'RUNNING' AND parent_task_id IS NOT NULL`)
    .all() as AgentTask[];

  for (const s of staleSubtasks) {
    updateTask(s.id, {
      status: "QUEUED",
      current_step: null,
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    logActivity({
      user_id: s.user_id,
      task_id: s.id,
      event_type: "TASK_RECOVERY",
      message: `${s.title}: reset to queued after the server restarted mid-step.`,
    });
  }

  const staleParents = db
    .prepare(`SELECT * FROM agent_tasks WHERE status = 'RUNNING' AND parent_task_id IS NULL`)
    .all() as AgentTask[];

  for (const t of staleParents) {
    updateTask(t.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    logActivity({
      user_id: t.user_id,
      task_id: t.id,
      event_type: "TASK_RECOVERY",
      message: `${t.title} was interrupted by a server restart. Review progress and resume when ready.`,
    });
  }
}

export function startEngine(): void {
  if (global.__innocentIntelligenceEngineStarted) return;
  global.__innocentIntelligenceEngineStarted = true;
  startPortfolioScheduler();

  recoverInterruptedTasks();

  setInterval(() => {
    tick().catch((err) => console.error("[taskEngine] tick() threw:", err));
  }, TICK_INTERVAL_MS);

  console.log(
    `[taskEngine] Started. Ticking every ${TICK_INTERVAL_MS / 1000}s inside this Node process.`
  );
}

// Re-exported for the manual "/api/tasks/tick" test endpoint.
export { getTaskById };
