import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { listConversations } from "@/lib/models/chat";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const conversations = await listConversations(LOCAL_USER_ID);
    return noCacheJson({ conversations });
  } catch (error) {
    console.error("[api/chat/conversations] GET failed:", error);
    return noCacheJson({ error: "Could not load conversations." }, { status: 500 });
  }
}
