import { noCacheJson } from "@/lib/noCacheJson";
import { listActiveSuggestions } from "@/lib/models/agentQuestions";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const suggestions = await listActiveSuggestions(LOCAL_USER_ID);
    return noCacheJson({ suggestions });
  } catch (error) {
    console.error("[api/agent-suggestions] GET failed:", error);
    return noCacheJson({ error: "Could not load suggestions." }, { status: 500 });
  }
}
