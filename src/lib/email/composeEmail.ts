/**
 * MILESTONE 3F — Follow-up campaigns.
 *
 * Composes one outreach email's subject + body for one prospect, using the
 * evidence-backed fields already on their record (never anything invented
 * beyond what prospecting actually found and verified).
 *
 * Deliberately does NOT use the OpenAI Agents SDK / tool-calling — this is
 * a single constrained generation from data already in hand, not a task
 * that needs web search or multi-turn reasoning. A plain chat completion
 * is simpler, cheaper, and has a smaller/safer surface area.
 *
 * The compliance footer (sender identity, postal address, unsubscribe
 * link) is NOT part of what this generates — see
 * src/lib/email/sendEmail.ts's appendComplianceFooter(), which is applied
 * unconditionally afterward. This module is explicitly instructed not to
 * write anything resembling a sign-off, so the two never conflict or
 * duplicate.
 */

import OpenAI from "openai";
import type { Prospect } from "@/lib/models/prospects";
import type { Product } from "@/lib/types";
import type { EmailSend } from "@/lib/models/emailSends";

const MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `
You write short, plain, respectful B2B outreach emails on behalf of Innocent Labs.

STRICT GROUNDING RULE:
You may only reference facts explicitly given to you about the prospect and
the product below. You must NEVER:
- invent details about the prospect's company, achievements, needs, or circumstances;
- claim the prospect has previously expressed interest, engaged, replied, or taken any action they have not;
- claim specific results, customer counts, or metrics for the product that are not given to you;
- use manipulative urgency, fake scarcity, or misleading subject lines.

If the given evidence is thin, write a shorter, more modest email rather than
padding it with invented specifics.

TONE:
Plain, direct, human, low-hype. Write like a real person emailing another
professional, not like a marketing blast. Two to four short paragraphs at
most for an initial email; even shorter for a follow-up.

FOLLOW-UPS:
If this is a follow-up (step > 0), keep it brief, reference that you wrote
before without repeating it verbatim, and add ONE new, small, genuine reason
to reply — never guilt, pressure, or repetition of the same pitch.

DO NOT INCLUDE:
- a signature, sign-off name, company postal address, or unsubscribe text —
  these are appended separately and automatically; adding your own would
  duplicate them.

OUTPUT FORMAT:
Respond with ONLY a JSON object: {"subject": "...", "body": "..."}
No markdown fences, no extra commentary.
`.trim();

export interface ComposeEmailInput {
  prospect: Prospect;
  product: Product;
  step: number;
  previousSends: EmailSend[];
}

export interface ComposedEmail {
  subject: string;
  body: string;
}

function buildUserPrompt(input: ComposeEmailInput): string {
  const { prospect, product, step, previousSends } = input;

  const lines: string[] = [];

  lines.push(`STEP: ${step === 0 ? "Initial outreach email" : `Follow-up #${step}`}`);
  lines.push("");
  lines.push("PROSPECT:");
  lines.push(`- Name: ${prospect.name}`);
  if (prospect.role) lines.push(`- Role: ${prospect.role}`);
  if (prospect.organization) lines.push(`- Organization: ${prospect.organization}`);
  if (prospect.fit_reason) lines.push(`- Why they may be a fit: ${prospect.fit_reason}`);
  if (prospect.opportunity_signal) {
    lines.push(`- Observed opportunity signal: ${prospect.opportunity_signal}`);
  }
  if (prospect.evidence.length > 0) {
    lines.push("- Evidence on file:");
    for (const e of prospect.evidence.slice(0, 5)) {
      lines.push(`  - ${e.observation} (source: ${e.source})`);
    }
  }

  lines.push("");
  lines.push("PRODUCT BEING OFFERED:");
  lines.push(`- Name: ${product.name}`);
  if (product.description) lines.push(`- Description: ${product.description}`);
  if (product.problem) lines.push(`- Problem it solves: ${product.problem}`);
  if (product.audience) lines.push(`- Intended audience: ${product.audience}`);
  if (product.positioning) lines.push(`- Positioning: ${product.positioning}`);
  if (product.cta) lines.push(`- Call to action: ${product.cta}`);
  if (product.url) lines.push(`- URL: ${product.url}`);

  if (previousSends.length > 0) {
    lines.push("");
    lines.push("PREVIOUS EMAILS ALREADY SENT IN THIS SEQUENCE (do not repeat):");
    for (const send of previousSends) {
      lines.push(`- Step ${send.step} subject: "${send.subject}"`);
    }
  }

  return lines.join("\n");
}

function parseComposedEmail(raw: string): ComposedEmail {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Email composer returned non-JSON output.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).subject !== "string" ||
    typeof (parsed as Record<string, unknown>).body !== "string"
  ) {
    throw new Error('Email composer output did not match {"subject","body"}.');
  }

  const subject = (parsed as { subject: string }).subject.trim();
  const body = (parsed as { body: string }).body.trim();

  if (!subject || !body) {
    throw new Error("Email composer returned an empty subject or body.");
  }

  return { subject, body };
}

export async function composeOutreachEmail(
  input: ComposeEmailInput
): Promise<ComposedEmail> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — cannot compose email content.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
    temperature: 0.6,
  });

  const raw = completion.choices[0]?.message?.content;

  if (!raw) {
    throw new Error("Email composer returned no output.");
  }

  return parseComposedEmail(raw);
}
