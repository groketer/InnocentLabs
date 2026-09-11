import { NextRequest, NextResponse } from "next/server";
import { dismissSuggestion } from "@/lib/models/agentQuestions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await dismissSuggestion(LOCAL_USER_ID, params.id);
    return NextResponse.json({ dismissed: true });
  } catch (error) {
    console.error("[api/agent-suggestions/[id]/dismiss] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not dismiss suggestion.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
