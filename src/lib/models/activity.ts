import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import type { ActivityEvent, ActivityEventType } from "@/lib/types";

export interface LogActivityInput {
  user_id: string;
  task_id?: string | null;
  event_type: ActivityEventType;
  message: string;
  metadata?: Record<string, unknown> | null;
  severity?: "info" | "warning" | "error" | "success";
  subtask_id?: string | null;
}

/**
 * Persists an activity event.
 *
 * Activity events are part of the system's operational audit trail.
 * Additional context belongs in metadata so that we can extend the event
 * model without repeatedly changing the database schema.
 *
 * In particular, subtask_id is preserved inside metadata rather than being
 * silently discarded. This allows an event to retain its precise task
 * lineage even though activity_events currently stores only task_id as a
 * first-class relational column.
 */
export function logActivity(input: LogActivityInput): ActivityEvent {
  const db = getDb();
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
  };

  if (input.subtask_id) {
    metadata.subtask_id = input.subtask_id;
  }

  const serializedMetadata =
    Object.keys(metadata).length > 0
      ? JSON.stringify(metadata)
      : null;

  const severity =
    input.severity ??
    (
      input.event_type.includes("FAILED")
        ? "error"
        : input.event_type.includes("COMPLETED")
          ? "success"
          : input.event_type.includes("PAUSED") ||
              input.event_type.includes("NEEDS_INPUT")
            ? "warning"
            : "info"
    );

  db.prepare(
    `INSERT INTO activity_events (
      id,
      user_id,
      task_id,
      event_type,
      message,
      metadata,
      severity,
      created_at
    )
    VALUES (
      @id,
      @user_id,
      @task_id,
      @event_type,
      @message,
      @metadata,
      @severity,
      @created_at
    )`
  ).run({
    id,
    user_id: input.user_id,
    task_id: input.task_id ?? null,
    event_type: input.event_type,
    message: input.message,
    metadata: serializedMetadata,
    severity,
    created_at: timestamp,
  });

  return db
    .prepare(`SELECT * FROM activity_events WHERE id = ?`)
    .get(id) as ActivityEvent;
}

export interface ListActivityOptions {
  user_id: string;
  task_id?: string;
  eventTypes?: ActivityEventType[];
  limit?: number;
}

export function listActivity(
  options: ListActivityOptions
): ActivityEvent[] {
  const db = getDb();

  const clauses: string[] = ["user_id = @user_id"];
  const params: Record<string, unknown> = {
    user_id: options.user_id,
  };

  if (options.task_id) {
    clauses.push("task_id = @task_id");
    params.task_id = options.task_id;
  }

  if (options.eventTypes && options.eventTypes.length > 0) {
    const placeholders = options.eventTypes
      .map((_, i) => `@et${i}`)
      .join(", ");

    clauses.push(`event_type IN (${placeholders})`);

    options.eventTypes.forEach((eventType, i) => {
      params[`et${i}`] = eventType;
    });
  }

  const limit = options.limit ?? 200;
  params.limit = limit;

  return db
    .prepare(
      `SELECT *
       FROM activity_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT @limit`
    )
    .all(params) as ActivityEvent[];
}