import { NextRequest, NextResponse } from "next/server";
import { createTask } from "@/lib/models/tasks";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";

/**
 * DEV/TESTING ONLY. Creates a task exactly the way the create_task agent
 * tool does (see src/agents/tools/createTaskTool.ts), without needing a
 * live OpenAI API call. This exists so the task engine itself — the
 * actual subject of Milestone 3A — can be verified end-to-end even in
 * environments without network access to the OpenAI API. It performs a
 * real database write; the engine treats it identically to a
 * chat-created task.
 */
export async function POST(req: NextRequest) {
  let body: { title?: string; description?: string; task_type?: string; max_retries?: number } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine, use defaults
  }

  const task = await createTask({
    user_id: LOCAL_USER_ID,
    title: body.title ?? "Test: Innocent Labs Website Audit",
    description:
      body.description ?? "Audit the homepages of all portfolio products that have a known URL.",
    task_type: body.task_type ?? "website_audit",
    status: "QUEUED",
    created_by: "system",
    max_retries: body.max_retries ?? 3,
  });

  await logActivity({
    user_id: LOCAL_USER_ID,
    task_id: task.id,
    event_type: "TASK_CREATED",
    message: `${task.title}: created via dev test endpoint.`,
  });

  return NextResponse.json({ task });
}
