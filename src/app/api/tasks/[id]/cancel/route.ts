import { NextRequest, NextResponse } from "next/server";
import { cancelTask, TaskActionError } from "@/lib/taskEngine/actions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const task = await cancelTask(params.id, LOCAL_USER_ID);
    return NextResponse.json({ task });
  } catch (error) {
    if (error instanceof TaskActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/tasks/:id/cancel] failed:", error);
    return NextResponse.json({ error: "Could not cancel task." }, { status: 500 });
  }
}
