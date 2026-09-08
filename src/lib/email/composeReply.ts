/**
 * MILESTONE 3J — Inbound email, autonomous replies.
 *
 * Composes a reply to an inbound message from a prospect who wrote back.
 * Innocent explicitly chose fully autonomous replies — but "fully
 * autonomous" and "replies to absolutely everything with no exception"
 * aren't the same thing. This includes ONE narrow, explicit escalation
 * path: situations where even a genuinely business-savvy human operator
 * would stop and think rather than reflexively reply. That is not a
 * watered-down version of autonomy; it's what a competent operator
 * running their own business would actually do. Everything else is
 * handled with no human involved at all.
 *
 * Escalation is intentionally narrow — see ESCALATE_WHEN below. It is NOT
 * a general-purpose "when unsure, ask a human" hedge; the bar is real
 * risk (legal, financial commitment, hostility), not routine uncertainty.
 */

import OpenAI from "openai";
import type { Prospect } from "@/lib/models/prospects";
import type { Product } from "@/lib/types";
import type { EmailSend } from "@/lib/models/emailSends";
import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

const MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `
You are handling the reply side of an email conversation with a prospect who
wrote back after receiving outreach about an Innocent Labs product. You act
on Innocent's behalf, fully autonomously, for the large majority of replies.

STRICT GROUNDING RULE (same as any other outreach):
Only reference facts explicitly given to you about the prospect, the
product, and the conversation so far. Never invent details, never claim
results or metrics not given to you, never promise anything about
pricing, features, timelines, or terms beyond what's explicitly in the
product information given to you.

PRODUCT NAME:
Always use the product's exact full name as given — never shorten or
paraphrase it.

GRAMMAR AND PUNCTUATION:
Every sentence must be grammatically correct and properly punctuated. A
sloppy reply undermines trust in a real conversation even more than in a
first cold email.

TONE:
Warm, direct, human — like a real person continuing a real conversation,
not a scripted bot. Match the prospect's own tone and length reasonably;
don't send a long reply to a one-line question.

GREETING:
If you open with a greeting at all, use the prospect's real name if
known, or a generic "Hi there," if not — never a bracketed placeholder
like [Recipient's Name] or similar, under any circumstances. In an
ongoing reply this often isn't needed at all — jumping straight into the
response is usually more natural than re-greeting someone you're already
mid-conversation with.

NO CITATIONS OR MARKDOWN LINKS:
Plain prose only — no citation markup, no markdown link syntax like
"[text](url)". Write any URL out plainly instead.

==================================================
ESCALATE INSTEAD OF REPLYING WHEN:
==================================================

Escalating means: do NOT compose a reply. Instead, flag this for Innocent
to handle personally. Escalate when the message:

- expresses anger, hostility, a formal complaint, or a legal threat;
- asks for a specific discount, custom pricing, a contract, a refund, or
  any commitment beyond what's already stated in the product information;
- explicitly asks to speak with a real person, not an assistant/bot;
- asks something you cannot answer confidently from the product
  information given to you (do not guess or improvise an answer just to
  avoid escalating);
- raises anything that seems like it could carry real legal, financial,
  or reputational weight, even if you're not sure exactly why it feels
  that way.

When in doubt between replying and escalating on one of the above grounds
specifically, escalate. This is a narrow, deliberate exception — not a
general license to escalate whenever a reply is merely hard to write. If
none of the above apply, reply.

==================================================
UNSUBSCRIBE REQUESTS — HANDLE DIRECTLY, NEVER ESCALATE
==================================================

If the message clearly asks to stop being contacted — "unsubscribe me",
"please stop emailing", "remove me from your list", "take me off this",
or similar in substance even if worded differently — this is NOT an
escalation case and is NOT a normal reply case either. This has gone
wrong before: treated as an ordinary reply, it produced a polite
acknowledgment that stopping would happen, without anything actually
stopping — the person kept receiving emails after being told they
wouldn't. A clear unsubscribe request must actually result in being
unsubscribed, not just a message saying so.

Use the "unsubscribe" action below for this. Do not use "escalate" for a
plain, unambiguous unsubscribe request — that would just delay something
that should happen immediately. Only escalate if the message mixes an
unsubscribe request with something else that genuinely needs Innocent's
judgment (e.g. a complaint alongside the request) — in that case,
escalate rather than guessing which part takes priority.

==================================================
OUTPUT FORMAT
==================================================

Respond with ONLY a JSON object, no markdown fences, no extra commentary:

{"action": "reply", "subject": "...", "body": "..."}

or

{"action": "unsubscribe", "acknowledgment": "a short, warm one-to-two sentence confirmation that they won't hear from us again"}

or

{"action": "escalate", "reason": "one sentence explaining why, for Innocent to read"}

DO NOT INCLUDE a signature, sign-off name, postal address, or unsubscribe
text in "body" — those are appended automatically.

IF YOU DO INCLUDE ANY CLOSING LINE ANYWAY (e.g. "Best regards,"):
This has gone wrong before — a placeholder like "[Your Name]" was sent to
a real person. If a closing appears at all, it must be signed with the
exact name "Innocent Mwangi" — never a placeholder, never any other name,
never left blank. But the strong preference is still to omit a closing
entirely.
`.trim();

export interface ComposeReplyInput {
  prospect: Prospect;
  product: Product | null;
  history: EmailSend[];
  inboundSubject: string;
  inboundText: string;
}

export type ComposeReplyResult =
  | { action: "reply"; subject: string; body: string }
  | { action: "unsubscribe"; acknowledgment: string }
  | { action: "escalate"; reason: string };

function buildUserPrompt(input: ComposeReplyInput): string {
  const { prospect, product, history, inboundSubject, inboundText } = input;
  const lines: string[] = [];

  lines.push("PROSPECT:");
  lines.push(`- Name: ${prospect.name}`);
  if (prospect.role) lines.push(`- Role: ${prospect.role}`);
  if (prospect.organization) lines.push(`- Organization: ${prospect.organization}`);

  if (product) {
    lines.push("");
    lines.push("PRODUCT BEING DISCUSSED:");
    lines.push(`- Name: ${product.name}`);
    if (product.description) lines.push(`- Description: ${product.description}`);
    if (product.problem) lines.push(`- Problem it solves: ${product.problem}`);
    if (product.audience) lines.push(`- Intended audience: ${product.audience}`);
    if (product.positioning) lines.push(`- Positioning: ${product.positioning}`);
    if (product.pricing) lines.push(`- Pricing: ${product.pricing}`);
    if (product.cta) lines.push(`- Call to action: ${product.cta}`);
    if (product.url) lines.push(`- URL: ${product.url}`);
  }

  if (history.length > 0) {
    lines.push("");
    lines.push("CONVERSATION SO FAR (oldest first):");
    for (const send of history) {
      const who = send.direction === "reply" ? "You (assistant)" : "You (initial outreach)";
      lines.push(`- ${who}, subject "${send.subject}": ${send.body.slice(0, 500)}`);
    }
  }

  lines.push("");
  lines.push("THEIR NEW MESSAGE, JUST RECEIVED:");
  lines.push(`Subject: ${inboundSubject}`);
  lines.push(inboundText.slice(0, 3000));

  return lines.join("\n");
}

function parseResult(raw: string): ComposeReplyResult {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Reply composer returned non-JSON output.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Reply composer output was not a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.action === "escalate") {
    if (typeof obj.reason !== "string" || !obj.reason.trim()) {
      throw new Error('Escalation output missing a "reason".');
    }
    return { action: "escalate", reason: obj.reason.trim() };
  }

  if (obj.action === "unsubscribe") {
    if (typeof obj.acknowledgment !== "string" || !obj.acknowledgment.trim()) {
      throw new Error('Unsubscribe output missing an "acknowledgment".');
    }
    return { action: "unsubscribe", acknowledgment: obj.acknowledgment.trim() };
  }

  if (obj.action === "reply") {
    if (typeof obj.subject !== "string" || typeof obj.body !== "string") {
      throw new Error('Reply output missing "subject" or "body".');
    }
    if (!obj.subject.trim() || !obj.body.trim()) {
      throw new Error("Reply composer returned an empty subject or body.");
    }
    return { action: "reply", subject: obj.subject.trim(), body: obj.body.trim() };
  }

  throw new Error(`Reply composer returned an unrecognized action: ${String(obj.action)}`);
}

export async function composeReply(
  input: ComposeReplyInput
): Promise<ComposeReplyResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — cannot compose a reply.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    temperature: 0.5,
  });

  if (completion.usage) {
    await recordApiUsage({
      user_id: LOCAL_USER_ID,
      source: "reply_compose",
      model: MODEL,
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens,
    });
  }

  const raw = completion.choices[0]?.message?.content;

  if (!raw) {
    throw new Error("Reply composer returned no output.");
  }

  return parseResult(raw);
}
