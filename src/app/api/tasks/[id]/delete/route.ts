import { NextRequest, NextResponse } from "next/server";
import { deleteTask, TaskActionError } from "@/lib/taskEngine/actions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await deleteTask(params.id, LOCAL_USER_ID);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof TaskActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/tasks/:id/delete] failed:", error);
    return NextResponse.json({ error: "Could not delete task." }, { status: 500 });
  }
}
