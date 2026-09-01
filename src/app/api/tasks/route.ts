import { NextRequest, NextResponse } from "next/server";
import { listTasks } from "@/lib/models/tasks";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type { TaskStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const topLevelOnly = searchParams.get("topLevelOnly") !== "false";
    const statusParam = searchParams.get("status");
    const statuses = statusParam
      ? (statusParam.split(",") as TaskStatus[])
      : undefined;
    const limitParam = searchParams.get("limit");

    const tasks = listTasks({
      user_id: LOCAL_USER_ID,
      topLevelOnly,
      statuses,
      limit: limitParam ? Number(limitParam) : undefined,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("[api/tasks] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load tasks." },
      { status: 500 }
    );
  }
}
