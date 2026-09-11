import { noCacheJson } from "@/lib/noCacheJson";
import { listPendingQuestions } from "@/lib/models/agentQuestions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const questions = await listPendingQuestions(LOCAL_USER_ID);
    return noCacheJson({ questions });
  } catch (error) {
    console.error("[api/agent-questions] GET failed:", error);
    return noCacheJson({ error: "Could not load questions." }, { status: 500 });
  }
}
