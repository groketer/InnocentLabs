export type TaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "RETRYING"
  | "NEEDS_INPUT"
  | "COMPLETED"
  | "COMPLETED_WITH_ISSUES"
  | "FAILED"
  | "CANCELLED"; // small, deliberate addition beyond the spec's minimum status
// list, for user-initiated stops — see Milestone 3A report.

export type TaskPriority = "low" | "normal" | "high";

export type TaskCreatedBy = "agent" | "user" | "system";

export interface AgentTask {
  id: string;
  user_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  task_type: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
  paused_at: string | null;
  last_activity_at: string | null;
  next_retry_at: string | null;
  progress_current: number;
  progress_total: number | null;
  progress_label: string | null;
  current_step: string | null;
  current_subtask: string | null;
  worker_id: string | null;
  execution_id: string | null;
  heartbeat_at: string | null;
  last_attempt_at: string | null;
  result_summary: string | null;
  result_json: string | null;
  result_reference: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  conversation_id: string | null;
  requires_user_input: 0 | 1;
  input_reason: string | null;
  created_by: TaskCreatedBy;
}

export interface AgentTaskWithChildren extends AgentTask {
  subtasks: AgentTask[];
}

export type ActivityEventType =
  | "TASK_CREATED"
  | "TASK_STARTED"
  | "TASK_PAUSED"
  | "TASK_RESUMED"
  | "TASK_RETRYING"
  | "TASK_CANCELLED"
  | "SUBTASK_STARTED"
  | "SUBTASK_COMPLETED"
  | "SUBTASK_FAILED"
  | "TASK_NEEDS_INPUT"
  | "TASK_COMPLETED"
  | "TASK_COMPLETED_WITH_ISSUES"
  | "TASK_FAILED"
  | "USER_APPROVAL_REQUIRED"
  | "TASK_RECOVERY";

export interface ActivityEvent {
  id: string;
  user_id: string;
  task_id: string | null;
  event_type: ActivityEventType;
  message: string;
  metadata: string | null; // JSON-encoded
  severity: "info" | "warning" | "error" | "success";
  created_at: string;
}

export type ProductStatus =
  | "active"
  | "paused"
  | "unknown"
  | "improving"
  | "temporary"
  | "discontinued";

/**
 * Canonical evidence classification.
 *
 * Evidence is an observation that can be traced to a source.
 * It is deliberately separate from interpretation or inference.
 */
export type EvidenceType = "DIRECT_WEBSITE_OBSERVATION";

export type EvidenceSourceType = "website";

/**
 * A normalized piece of evidence produced by an executor.
 *
 * IMPORTANT:
 * This represents what was observed, not what the observation means.
 * Higher-level interpretation and inference belong to the intelligence layer.
 */
export interface EvidenceItem {
  id: string;
  evidence_type: EvidenceType;
  source_type: EvidenceSourceType;
  source_url: string;
  observed_at: string;

  /**
   * Human-readable description of the directly observed fact.
   */
  observation: string;

  /**
   * Confidence in the observation itself, expressed from 0 to 1.
   * This is NOT confidence in a conclusion derived from the evidence.
   */
  confidence: number;
}

export interface Product {
  id: string;
  name: string;
  url: string | null;
  status: ProductStatus;
  asset_type: "product" | "hub";
  category: string;
  description: string | null;
  future_url: string | null;
  notes: string | null;
  problem: string | null;
  audience: string | null;
  positioning: string | null;
  features: string | null;
  commercial_model: string | null;
  pricing: string | null;
  cta: string | null;
  evidence: string | null;
  unknowns: string | null;
  confidence: number | null;
  last_audited_at: string | null;
  created_at: string;
  updated_at: string;
}