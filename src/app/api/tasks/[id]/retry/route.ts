import { NextRequest, NextResponse } from "next/server";
import { retryTask, TaskActionError } from "@/lib/taskEngine/actions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const task = retryTask(params.id, LOCAL_USER_ID);
    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof TaskActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/tasks/:id/retry] failed:", error);
    return NextResponse.json({ error: "Could not retry task." }, { status: 500 });
  }
}
