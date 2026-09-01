import type { AgentTask, EvidenceItem } from "@/lib/types";

/**
 * A single subtask the executor wants created when a task starts.
 */
export interface SubtaskPlanItem {
  title: string;
  description?: string;
}

/**
 * Structured data returned by an executor.
 *
 * Evidence is explicitly represented using the application's canonical
 * EvidenceItem type. Additional executor-specific fields remain supported
 * through the index signature so existing executors are not unnecessarily
 * constrained.
 *
 * Evidence describes what was observed. Interpretation and inference belong
 * to higher intelligence layers.
 */
export interface TaskResultData {
  /**
   * Directly observed evidence associated with this result.
   */
  evidence?: EvidenceItem[];

  /**
   * Additional structured fields produced by an executor.
   */
  [key: string]: unknown;
}

/**
 * The result of running one real unit of work
 * (one subtask, or a whole task with no subtasks).
 */
export interface StepResult {
  success: boolean;

  /**
   * Human-readable summary of what actually happened.
   *
   * Never invent this. It must describe a real outcome.
   */
  summary: string;

  /**
   * Set when the agent genuinely cannot proceed without a decision
   * from the user.
   */
  needsInput?: boolean;

  needsInputMessage?: string;

  /**
   * Set when the failure looks temporary
   * (network blip, timeout, rate limit) and is worth retrying.
   */
  transientFailure?: boolean;

  errorMessage?: string;

  /**
   * Structured, evidence-preserving output for the task detail view
   * and future intelligence layer.
   */
  resultData?: TaskResultData;
}

export interface TaskExecutor {
  taskType: string;

  /**
   * For tasks that decompose into subtasks.
   * Called once, when a QUEUED task starts.
   */
  planSubtasks?(
    task: AgentTask
  ): Promise<SubtaskPlanItem[]> | SubtaskPlanItem[];

  /**
   * Executes one subtask.
   * Required if planSubtasks is defined.
   */
  runSubtask?(
    task: AgentTask,
    subtask: AgentTask
  ): Promise<StepResult>;

  /**
   * For simple, single-step tasks with no subtasks.
   */
  runTask?(
    task: AgentTask
  ): Promise<StepResult>;
}