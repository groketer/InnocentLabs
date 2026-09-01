import { NextResponse } from "next/server";
import { computeAgentStatus } from "@/lib/models/agentStatus";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";

export async function GET() {
  try {
    const status = computeAgentStatus(LOCAL_USER_ID);
    return NextResponse.json({ status });
  } catch (error) {
    console.error("[api/agent-status] GET failed:", error);
    return NextResponse.json(
      { error: "Could not compute agent status." },
      { status: 500 }
    );
  }
}
