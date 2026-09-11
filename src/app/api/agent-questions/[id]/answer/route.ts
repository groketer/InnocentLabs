import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/models/agentQuestions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    if (!answer) {
      return NextResponse.json({ error: "An answer is required." }, { status: 400 });
    }

    const question = await answerQuestion(LOCAL_USER_ID, params.id, answer);
    return NextResponse.json({ question });
  } catch (error) {
    console.error("[api/agent-questions/[id]/answer] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not answer question.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
