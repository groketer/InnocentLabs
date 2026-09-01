import { listTasks } from "@/lib/models/tasks";
import { STALE_HEARTBEAT_MS } from "@/lib/taskEngine/engine";
import type { AgentTask } from "@/lib/types";

export type AgentStatusState =
  | "WORKING"
  | "POSSIBLY_STALLED"
  | "NEEDS_INPUT"
  | "PAUSED"
  | "ERROR"
  | "COMPLETED"
  | "IDLE";

export interface AgentStatus {
  state: AgentStatusState;
  label: string;
  task: AgentTask | null;
}

function isStale(task: AgentTask): boolean {
  if (!task.last_activity_at) return false;
  return Date.now() - new Date(task.last_activity_at).getTime() > STALE_HEARTBEAT_MS;
}

export function computeAgentStatus(userId: string): AgentStatus {
  const tasks = listTasks({ user_id: userId, topLevelOnly: true, limit: 50 });

  const running = tasks.find((t) => t.status === "RUNNING");
  if (running) {
    if (isStale(running)) {
      return {
        state: "POSSIBLY_STALLED",
        label: `Possibly stalled — no activity for a while on "${running.title}"`,
        task: running,
      };
    }
    return { state: "WORKING", label: `Working on "${running.title}"`, task: running };
  }

  const needsInput = tasks.find((t) => t.status === "NEEDS_INPUT");
  if (needsInput) {
    return {
      state: "NEEDS_INPUT",
      label: `Waiting for your input on "${needsInput.title}"`,
      task: needsInput,
    };
  }

  const queued = tasks.find((t) => t.status === "QUEUED");
  if (queued) {
    return { state: "WORKING", label: `Queued: "${queued.title}"`, task: queued };
  }

  const paused = tasks.find((t) => t.status === "PAUSED");
  if (paused) {
    return { state: "PAUSED", label: `Paused: "${paused.title}"`, task: paused };
  }

  const failed = tasks.find((t) => t.status === "FAILED");
  if (failed) {
    return { state: "ERROR", label: `Failed: "${failed.title}"`, task: failed };
  }

  const completed = tasks.find((t) => t.status === "COMPLETED");
  if (completed) {
    return {
      state: "COMPLETED",
      label: `Last task completed: "${completed.title}"`,
      task: completed,
    };
  }

  return { state: "IDLE", label: "No tasks yet", task: null };
}
