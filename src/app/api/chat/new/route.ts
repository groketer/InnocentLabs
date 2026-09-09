import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { listChatMessages } from "@/lib/models/chat";
import { saveConversationSummary } from "@/lib/models/memory";
import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `
Summarize this conversation in 3-5 sentences, for future reference by
the same AI agent in a LATER, separate conversation. Write it as
context a colleague would need to pick up where this left off — what
was discussed, what was decided or started, and anything genuinely
worth remembering. Skip pleasantries and routine back-and-forth. Be
concrete and specific rather than vague ("discussed the Products page"
tells the agent nothing useful; "reviewed UHIKO Properties pricing and
decided to keep the current tiers" does).

Respond with ONLY the summary text, no preamble, no markdown formatting.
`;

/**
 * MILESTONE 4D — the trigger point for conversation summarization.
 * Called when the user explicitly starts a new chat, so the outgoing
 * conversation gets a real summary saved before its history effectively
 * goes quiet — this is what future conversations pull in for
 * continuity (see src/app/api/chat/route.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required." }, { status: 400 });
    }

    const messages = await listChatMessages(conversationId, LOCAL_USER_ID);

    // Nothing worth summarizing — a conversation with only a couple of
    // messages (or none) doesn't need a summary entry cluttering memory.
    if (messages.length < 4) {
      return NextResponse.json({ summarized: false, reason: "Too short to summarize." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ summarized: false, reason: "OPENAI_API_KEY not configured." });
    }

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Innocent" : "Agent"}: ${m.content}`)
      .join("\n\n");

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content?.trim();

    if (!summary) {
      return NextResponse.json({ summarized: false, reason: "Model returned no summary." });
    }

    await saveConversationSummary({
      conversation_id: conversationId,
      user_id: LOCAL_USER_ID,
      summary,
      message_count: messages.length,
    });

    if (completion.usage) {
      await recordApiUsage({
        user_id: LOCAL_USER_ID,
        source: "chat",
        model: MODEL,
        input_tokens: completion.usage.prompt_tokens,
        output_tokens: completion.usage.completion_tokens,
      });
    }

    return NextResponse.json({ summarized: true, summary });
  } catch (error) {
    console.error("[api/chat/new] POST failed:", error);
    // Never block starting a new chat just because summarization failed
    // — that would be a worse outcome than a missed summary.
    return NextResponse.json({ summarized: false, reason: "Summarization failed." });
  }
}
