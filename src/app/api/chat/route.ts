import { NextRequest, NextResponse } from "next/server";
import { run, type AgentInputItem } from "@openai/agents";
import { createInnocentIntelligenceAgent } from "@/agents/masterAgent";
import { loadKnowledgeBase } from "@/lib/knowledge";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type { AgentRunContext } from "@/agents/context";
import { listChatMessages, saveChatMessage } from "@/lib/models/chat";

// This route must run on Node.js (not the Edge runtime) because it reads
// knowledge files from the filesystem, talks to the OpenAI API, and (via
// the create_task tool) writes to the SQLite task database.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
  return NextResponse.json({ messages: listChatMessages(conversationId, LOCAL_USER_ID) });
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  message: string;
  history?: ChatMessage[];
  /** Client-generated id for this browser chat session, so tasks created
   * from chat can be traced back to the conversation that spawned them. */
  conversationId?: string;
}

export async function POST(req: NextRequest) {
  // 1. Make sure the server is configured before doing any work.
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "[api/chat] OPENAI_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
    return NextResponse.json(
      {
        error:
          "The server is missing its OpenAI API key. (Developer: set OPENAI_API_KEY in .env.local, restart the dev server.)",
      },
      { status: 500 }
    );
  }

  // 2. Parse and validate the incoming request.
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const message = body?.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json(
      { error: "A non-empty 'message' string is required." },
      { status: 400 }
    );
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const conversationId = body.conversationId ?? "default";

  try {
    saveChatMessage({ conversation_id: conversationId, user_id: LOCAL_USER_ID, role: "user", content: message });
    // 3. Load the (currently file-based) knowledge layer.
    const knowledgeBase = await loadKnowledgeBase();

    // 4. Build the agent for this request, grounded in the knowledge base.
    const agent = createInnocentIntelligenceAgent(knowledgeBase);

    // 5. Reconstruct conversation input: prior turns + the new user message.
    const priorTurns: AgentInputItem[] = history
      .filter(
        (turn): turn is ChatMessage =>
          (turn?.role === "user" || turn?.role === "assistant") &&
          typeof turn?.content === "string"
      )
      .map((turn): AgentInputItem =>
        turn.role === "user"
          ? { role: "user", content: turn.content }
          : {
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: turn.content }],
            }
      );

    const input: AgentInputItem[] = [
      ...priorTurns,
      { role: "user", content: message },
    ];

    // 6. Run the agent, with a context the create_task tool can read.
    const context: AgentRunContext = {
      userId: LOCAL_USER_ID,
      conversationId,
    };
    const result = await run(agent, input, { context });

    // Surface any tasks the agent actually created during this turn, so
    // the UI can render a real, linked task card instead of just text.
    const tasksCreated: Array<{ taskId: string; title: string; status: string }> = [];
    for (const item of result.newItems) {
      if (item.type !== "tool_call_output_item") continue;
      if (typeof item.output !== "string") continue;
      try {
        const parsed = JSON.parse(item.output);
        if (parsed && typeof parsed.taskId === "string") {
          tasksCreated.push({
            taskId: parsed.taskId,
            title: parsed.title ?? "Untitled task",
            status: parsed.status ?? "QUEUED",
          });
        }
      } catch {
        // not a create_task tool output — ignore
      }
    }

    const reply = result.finalOutput ?? "";
    saveChatMessage({ conversation_id: conversationId, user_id: LOCAL_USER_ID, role: "assistant", content: reply });
    return NextResponse.json({
      reply,
      tasksCreated,
    });
  } catch (error) {
    // Never leak internal error details (stack traces, API responses,
    // etc.) to the client — log them server-side instead.
    console.error("[api/chat] Agent run failed:", error);
    return NextResponse.json(
      {
        error:
          "Something went wrong while talking to Innocent Intelligence. Please try again in a moment.",
      },
      { status: 502 }
    );
  }
}
