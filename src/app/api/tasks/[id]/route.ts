import { NextRequest, NextResponse } from "next/server";
import { getTaskWithSubtasks } from "@/lib/models/tasks";
import { listActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const task = await getTaskWithSubtasks(params.id);

    if (!task || task.user_id !== LOCAL_USER_ID) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }

    const activity = await listActivity({ user_id: LOCAL_USER_ID, task_id: task.id, limit: 100 });

    return NextResponse.json({ task, activity });
  } catch (error) {
    console.error("[api/tasks/:id] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load task." },
      { status: 500 }
    );
  }
}
