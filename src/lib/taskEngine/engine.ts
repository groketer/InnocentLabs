/**
 * The task engine.
 *
 * HOW AUTONOMOUS EXECUTION ACTUALLY WORKS HERE (read this before assuming
 * more than what's true):
 *
 * Historically (pre-Milestone 3E) this app ran on localhost as one
 * long-lived Node.js process (started by `next dev` or `next start`),
 * and this module started a `setInterval` loop inside that same process
 * the first time the server booted. Every tick, it looked at
 * QUEUED/RUNNING tasks in the database and advanced each one by exactly
 * one real unit of work, persisting the result before the next tick.
 *
 * MILESTONE 3E — VERCEL:
 *
 * Serverless functions don't keep a process alive between requests, so
 * the always-on `setInterval` loop cannot run there. `tick()` itself is
 * unchanged — it still advances every active top-level task by one real
 * unit of work and persists the result. What changed is *what drives*
 * `tick()`:
 *
 * - Locally (`next dev` / `next start`, i.e. NOT on Vercel), `startEngine()`
 *   still runs the old always-on `setInterval` loop, so local behavior is
 *   unchanged from before.
 * - On Vercel (`process.env.VERCEL` is set), `startEngine()` does NOT start
 *   an interval — instead, `tick()` is invoked externally:
 *     - by the client, via a small poller that calls `POST /api/tasks/tick`
 *       every few seconds while the app is open (see EngineTicker component);
 *     - by a daily Vercel Cron job hitting `/api/cron/daily`, as a backstop
 *       for when nobody has the app open.
 *
 * Either way, the underlying data model and `tick()` semantics are
 * identical — only the trigger mechanism differs by environment.
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
async function recordExecutorFailure(
  task: AgentTask,
  message: string,
  options?: {
    subtask?: AgentTask;
    retryable?: boolean;
  }
): Promise<void> {
  const subtask = options?.subtask;

  if (subtask) {
    await updateTask(subtask.id, {
      status: "FAILED",
      completed_at: nowIso(),
      error_message: `Executor error: ${message}`,
      last_activity_at: nowIso(),
      current_step: null,
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });

    await logActivity({
      user_id: task.user_id,
      task_id: subtask.id,
      event_type: "SUBTASK_FAILED",
      message: `${subtask.title}: executor error — ${message}`,
    });

    await recomputeParentProgress(task.id);
    return;
  }

  await updateTask(task.id, {
    status: "FAILED",
    completed_at: nowIso(),
    error_message: `Executor error: ${message}`,
    last_activity_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
  });

  await logActivity({
    user_id: task.user_id,
    task_id: task.id,
    event_type: "TASK_FAILED",
    message: `${task.title}: executor error — ${message}`,
  });
}

async function startTask(task: AgentTask): Promise<void> {
  const executor = getExecutor(task.task_type);

  if (!executor) {
    await updateTask(task.id, {
      status: "FAILED",
      error_message: `No executor registered for task_type "${task.task_type}".`,
      completed_at: nowIso(),
    });
    await logActivity({
      user_id: task.user_id,
      task_id: task.id,
      event_type: "TASK_FAILED",
      message: `Task could not start — no executor is registered for "${task.task_type}".`,
    });
    return;
  }

  const claimed = await claimTask(task.id, WORKER_ID, randomUUID());
  if (!claimed) return;
  task = claimed;
  await logActivity({
    user_id: task.user_id,
    task_id: task.id,
    event_type: "TASK_STARTED",
    message: `Started: ${task.title}`,
  });

  if (executor.planSubtasks) {
    let plan;

    try {
      plan = await executor.planSubtasks(task);
      await touchHeartbeat(task.id);
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      await recordExecutorFailure(task, message);
      return;
    }

    if (plan.length === 0) {
      await updateTask(task.id, {
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
      await logActivity({
        user_id: task.user_id,
        task_id: task.id,
        event_type: "TASK_COMPLETED",
        message: `${task.title}: nothing to do (no eligible items found).`,
      });
      return;
    }

    for (const item of plan) {
      await createTask({
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

    await recomputeParentProgress(task.id);
    return;
  }

  if (executor.runTask) {
    try {
      const result = await executor.runTask(task);
      await touchHeartbeat(task.id);
      await finishSimpleTask(task, result);
    } catch (err) {
      const message = errorMessageFromUnknown(err);
      await recordExecutorFailure(task, message);
    }
  }
}

async function finishSimpleTask(
  task: AgentTask,
  result: {
    success: boolean;
    summary: string;
    needsInput?: boolean;
    needsInputMessage?: string;
    resultData?: Record<string, unknown>;
  }
): Promise<void> {
  if (result.needsInput) {
    await updateTask(task.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      error_message: result.needsInputMessage ?? null,
      last_activity_at: nowIso(),
    });
    await logActivity({
      user_id: task.user_id,
      task_id: task.id,
      event_type: "TASK_NEEDS_INPUT",
      message: result.needsInputMessage ?? "This task needs your input to continue.",
    });
    return;
  }

  await updateTask(task.id, {
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
  await logActivity({
    user_id: task.user_id,
    task_id: task.id,
    event_type: result.success ? "TASK_COMPLETED" : "TASK_FAILED",
    message: `${task.title}: ${result.summary}`,
  });
}

async function advanceRunningTask(task: AgentTask): Promise<void> {
  const executor = getExecutor(task.task_type);
  if (!executor) return; // already handled at start

  const subtasks = await listSubtasks(task.id);

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

    await updateTask(task.id, {
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
    await logActivity({
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

  const claimed = await claimSubtask(subtask.id, WORKER_ID, randomUUID());
  if (!claimed) return;
  subtask = claimed;
  await updateTask(subtask.id, {
    current_step: isRetry ? `Retrying (attempt ${subtask.retry_count + 1})` : "In progress",
  });
  await updateTask(parent.id, {
    current_subtask: subtask.title,
    current_step: isRetry ? "Retrying a previous failure" : "Auditing",
    last_activity_at: nowIso(),
  });

  await logActivity({
    user_id: parent.user_id,
    task_id: subtask.id,
    event_type: "SUBTASK_STARTED",
    message: `${isRetry ? "Retrying" : "Starting"}: ${subtask.title}`,
  });

  let result;
  try {
    result = await executor.runSubtask(parent, subtask);
    await touchHeartbeat(parent.id);
    await touchHeartbeat(subtask.id);
  } catch (err) {
    await touchHeartbeat(parent.id);
    const message = errorMessageFromUnknown(err);
    await recordExecutorFailure(parent, message, { subtask });
    return;
  }

  if (result.success) {
    await updateTask(subtask.id, {
      status: "COMPLETED",
      completed_at: nowIso(),
      result_summary: result.summary,
      result_json: result.resultData ? JSON.stringify(result.resultData) : null,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
      user_id: parent.user_id,
      task_id: subtask.id,
      event_type: "SUBTASK_COMPLETED",
      message: `${subtask.title}: ${result.summary}`,
    });
    await recomputeParentProgress(parent.id);
    return;
  }

  if (result.needsInput) {
    await updateTask(subtask.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      error_message: result.needsInputMessage ?? result.errorMessage ?? null,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await updateTask(parent.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
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
    await updateTask(subtask.id, {
      status: "RETRYING",
      retry_count: nextRetryCount,
      next_retry_at: new Date(Date.now() + delay).toISOString(),
      error_message: result.errorMessage ?? result.summary,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
      user_id: parent.user_id,
      task_id: subtask.id,
      event_type: "TASK_RETRYING",
      message: `${subtask.title}: ${result.summary} — will retry (attempt ${nextRetryCount} of ${subtask.max_retries}).`,
    });
    return;
  }

  await updateTask(subtask.id, {
    status: "FAILED",
    completed_at: nowIso(),
    retry_count: nextRetryCount,
    error_message: result.errorMessage ?? result.summary,
    last_activity_at: nowIso(),
    worker_id: null,
    execution_id: null,
    heartbeat_at: null,
  });
  await logActivity({
    user_id: parent.user_id,
    task_id: subtask.id,
    event_type: "SUBTASK_FAILED",
    message: `${subtask.title}: ${result.summary}${
      result.transientFailure ? " (gave up after max retries)" : ""
    }`,
  });
  await recomputeParentProgress(parent.id);
}

/**
 * A Vercel serverless function that times out (see maxDuration on
 * /api/tasks/tick) is killed mid-execution with no chance to run any
 * cleanup code — so a subtask that was claimed (status RUNNING,
 * heartbeat set) right before its actual work overran the time limit is
 * left stuck in RUNNING forever. Nothing else was resetting it: the only
 * existing recovery, recoverInterruptedTasks() below, runs once per cold
 * start, and Vercel can keep reusing the same warm container across many
 * requests without ever cold-starting again — so a task orphaned by a
 * mid-flight timeout could stay stuck indefinitely with no code path that
 * would ever notice.
 *
 * This runs at the top of every tick() instead, so it doesn't depend on
 * cold-start timing at all. STALE_AFTER_MS is set comfortably above
 * /api/tasks/tick's maxDuration (60s) so a step that's still genuinely in
 * progress within its allowed time is never mistaken for orphaned.
 */
const STALE_AFTER_MS = 90_000;

async function recoverStaleRunningTasks(): Promise<void> {
  const db = await getDb();
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const staleSubtasksResult = await db.execute({
    sql: `
      SELECT * FROM agent_tasks
      WHERE status = 'RUNNING'
        AND parent_task_id IS NOT NULL
        AND (heartbeat_at IS NULL OR heartbeat_at < ?)
    `,
    args: [staleThreshold],
  });
  const staleSubtasks = staleSubtasksResult.rows as unknown as AgentTask[];

  const affectedParents = new Set<string>();

  for (const s of staleSubtasks) {
    await updateTask(s.id, {
      status: "QUEUED",
      current_step: null,
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
      user_id: s.user_id,
      task_id: s.id,
      event_type: "TASK_RETRYING",
      message: `${s.title}: reset to queued — the previous attempt appears to have timed out without finishing.`,
    });
    if (s.parent_task_id) affectedParents.add(s.parent_task_id);
  }

  for (const parentId of affectedParents) {
    await recomputeParentProgress(parentId);
  }

  // Top-level tasks stuck between being claimed and either finishing
  // planSubtasks()/runTask() or creating any subtasks — same idea, but
  // only when they have zero subtasks so far. A top-level task that
  // already has subtasks must NOT be reset to QUEUED: that would re-run
  // planSubtasks() and create a duplicate set of subtasks. Its own
  // progress recovers naturally once the subtask reset above lets a
  // fresh tick() pick the work back up.
  const staleTopLevelResult = await db.execute({
    sql: `
      SELECT * FROM agent_tasks t
      WHERE t.status = 'RUNNING'
        AND t.parent_task_id IS NULL
        AND (t.heartbeat_at IS NULL OR t.heartbeat_at < ?)
        AND NOT EXISTS (
          SELECT 1 FROM agent_tasks c WHERE c.parent_task_id = t.id
        )
    `,
    args: [staleThreshold],
  });
  const staleTopLevel = staleTopLevelResult.rows as unknown as AgentTask[];

  for (const t of staleTopLevel) {
    await updateTask(t.id, {
      status: "QUEUED",
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
      user_id: t.user_id,
      task_id: t.id,
      event_type: "TASK_RETRYING",
      message: `${t.title}: reset to queued — the previous attempt appears to have timed out without finishing.`,
    });
  }
}

/**
 * One tick: advance every active top-level task by exactly one real step
 * each. Safe to call concurrently/repeatedly — claimTask/claimSubtask make
 * task claiming atomic, so overlapping callers (e.g. a client poller and a
 * cron job both hitting /api/tasks/tick around the same time) cannot both
 * advance the same task twice.
 */
export async function tick(): Promise<void> {
  await recoverStaleRunningTasks();

  const tasks = await listActiveTopLevelTasks();

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
      await updateTask(task.id, {
        status: "FAILED",
        completed_at: nowIso(),
        error_message: `Unexpected engine error: ${message}`,
        worker_id: null,
        execution_id: null,
        heartbeat_at: null,
        last_activity_at: nowIso(),
      });
      await logActivity({
        user_id: task.user_id,
        task_id: task.id,
        event_type: "TASK_FAILED",
        message: `${task.title} failed due to an unexpected engine error.`,
      });
    }
  }
}

/**
 * Runs once at process start (locally) or once per cold start (on Vercel).
 * Any task/subtask still marked RUNNING at this point could not have been
 * ticked by *this* process/invocation — it must be left over from a
 * previous process that stopped (crash, manual stop, dev-server restart,
 * or — on Vercel — a serverless instance that was recycled mid-step). We
 * don't silently resume or silently discard it: subtasks are reset to
 * QUEUED (safe — they'll simply be retried), and the parent task is moved
 * to NEEDS_INPUT so a person decides whether to resume.
 */
export async function recoverInterruptedTasks(): Promise<void> {
  const db = await getDb();

  const staleSubtasksResult = await db.execute(
    `SELECT * FROM agent_tasks WHERE status = 'RUNNING' AND parent_task_id IS NOT NULL`
  );
  const staleSubtasks = staleSubtasksResult.rows as unknown as AgentTask[];

  for (const s of staleSubtasks) {
    await updateTask(s.id, {
      status: "QUEUED",
      current_step: null,
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
      user_id: s.user_id,
      task_id: s.id,
      event_type: "TASK_RECOVERY",
      message: `${s.title}: reset to queued after the server restarted mid-step.`,
    });
  }

  const staleParentsResult = await db.execute(
    `SELECT * FROM agent_tasks WHERE status = 'RUNNING' AND parent_task_id IS NULL`
  );
  const staleParents = staleParentsResult.rows as unknown as AgentTask[];

  for (const t of staleParents) {
    await updateTask(t.id, {
      status: "NEEDS_INPUT",
      requires_user_input: 1,
      last_activity_at: nowIso(),
      worker_id: null,
      execution_id: null,
      heartbeat_at: null,
    });
    await logActivity({
      user_id: t.user_id,
      task_id: t.id,
      event_type: "TASK_RECOVERY",
      message: `${t.title} was interrupted by a server restart. Review progress and resume when ready.`,
    });
  }
}

/**
 * Starts the engine.
 *
 * On Vercel, there is no long-lived process to keep an interval alive in,
 * so this deliberately does NOT start the setInterval loop there — see
 * the module doc comment above. `tick()` is still exported and still
 * fully functional; it is simply driven externally on Vercel (client
 * poller + daily cron) instead of by this loop.
 */
export function startEngine(): void {
  if (global.__innocentIntelligenceEngineStarted) return;
  global.__innocentIntelligenceEngineStarted = true;

  startPortfolioScheduler();

  recoverInterruptedTasks().catch((err) =>
    console.error("[taskEngine] recoverInterruptedTasks() threw:", err)
  );

  if (process.env.VERCEL) {
    console.log(
      "[taskEngine] Running on Vercel — skipping the in-process tick loop. " +
        "tick() is driven by client polling and the daily cron job instead."
    );
    return;
  }

  setInterval(() => {
    tick().catch((err) => console.error("[taskEngine] tick() threw:", err));
  }, TICK_INTERVAL_MS);

  console.log(
    `[taskEngine] Started. Ticking every ${TICK_INTERVAL_MS / 1000}s inside this Node process.`
  );
}

// Re-exported for the manual "/api/tasks/tick" test endpoint.
export { getTaskById };
