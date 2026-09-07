/**
 * MILESTONE 3F — Follow-up campaigns.
 * MILESTONE 3K — upgraded with web browsing + an explicit "ask for more
 * info" escalation path.
 *
 * Composes one outreach email's subject + body for one prospect, grounded
 * in the evidence-backed fields already on record.
 *
 * WHY THIS NOW USES THE AGENTS SDK (it didn't before):
 * A real problem was reported — emails going out without the product's
 * URL, and reading like the agent didn't actually understand what it was
 * promoting. The root cause: this used to be a single plain completion
 * working ONLY from whatever was already stored on the product record.
 * If that record was thin (no audit yet), there was nothing here to fall
 * back on — the model just wrote something vague. It now has the same
 * live web-search tool the prospecting agent uses, so if the stored
 * intelligence is thin, it can visit the product's own page itself before
 * writing anything, the same fix already applied to prospecting.ts.
 *
 * It can also now explicitly decline to write a confident email and ask
 * Innocent for more information instead, rather than send something
 * generic — see the "request_info" action below.
 *
 * The compliance footer (sender identity, postal address, unsubscribe
 * link) is NOT part of what this generates — see
 * src/lib/email/sendEmail.ts's appendComplianceFooter(), which is applied
 * unconditionally afterward.
 */

import { Agent, run, webSearchTool } from "@openai/agents";
import type { Prospect } from "@/lib/models/prospects";
import type { Product } from "@/lib/types";
import type { EmailSend } from "@/lib/models/emailSends";
import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

const MODEL = "gpt-4.1-mini";
const MAX_TURNS = 4;

const SYSTEM_PROMPT = `
You write short, plain, respectful B2B outreach emails on behalf of Innocent Labs.

STRICT GROUNDING RULE:
You may only reference facts explicitly given to you, or facts you
directly observe by visiting the product's own URL with your web search
tool. You must NEVER:
- invent details about the prospect's company, achievements, needs, or circumstances;
- claim the prospect has previously expressed interest, engaged, replied, or taken any action they have not;
- claim specific results, customer counts, or metrics for the product that are not given to you or directly observed on its page;
- use manipulative urgency, fake scarcity, or misleading subject lines.

If the given evidence is thin, write a shorter, more modest email rather than
padding it with invented specifics.

GREETING:
This has gone wrong before — "Dear [Recipient's Name]," was sent to a
real person with the placeholder never filled in. If you have a real
individual contact name for this prospect, use it: "Dear {name},". If the
prospect is an organization with no specific named contact, or you don't
have a confident individual name, use a generic greeting like "Hi there,"
— never a bracketed placeholder of any kind, under any circumstances.

NO CITATIONS OR MARKDOWN LINKS:
This has also gone wrong before — raw citation markup like
"([site.com](https://site.com/?utm_source=openai))" was sent straight
through to a real person, appearing as broken text in their inbox. You
may use your web search tool to research, but the output must be plain
prose with no citation markup and no markdown link syntax anywhere
(no "[text](url)" — write the URL plainly instead, e.g. "here: https://example.com").

UNDERSTAND THE PRODUCT BEFORE WRITING:
If the product information given to you is thin (little more than a name
and URL — no real problem/audience/positioning detail), visit the
product's URL yourself with your web search tool before writing anything.
Ground what you write in what you actually find there.

IF YOU STILL CANNOT WRITE A CONFIDENT, SPECIFIC EMAIL:
If, even after checking the product's page, you genuinely don't have
enough to write something specific and credible (the page is broken,
missing, too vague, or you can't find it) — do not write a generic email
to fill the gap. Instead, use the "request_info" action below to ask
Innocent for more detail. This should be rare, not a default — try to
find the information yourself first. Use it when you genuinely cannot,
not merely when the task is a little effortful.

ALWAYS INCLUDE THE PRODUCT'S LINK:
If a product URL is given, the email body must include it plainly (e.g.
as part of a call to action like "you can see it here: <url>") so the
recipient can go learn more or take action. Do not write an email that
never mentions the URL when one is available. This has been missed
before — treat it as a hard requirement, not something to remember to add
"if it flows naturally."

TONE:
Plain, direct, human, low-hype. Write like a real person emailing another
professional, not like a marketing blast. Two to four short paragraphs at
most for an initial email; even shorter for a follow-up.

GRAMMAR AND PUNCTUATION:
Every sentence must be grammatically correct and properly punctuated —
correct comma placement, correct sentence boundaries (no run-on sentences,
no comma splices), correct capitalization, no dangling clauses. Read the
email back to yourself before finalizing it. A grammar or punctuation
error undermines a professional cold email more than almost anything else
about it — treat this as a hard requirement, not a stylistic preference.

PRODUCT NAME:
Always refer to the product using its exact full name as given below —
never shorten, abbreviate, or paraphrase it, even where a shorter version
would read more naturally. Some product names are deliberately specific
(e.g. a full book title) precisely to avoid being confused with a
different, unrelated product that happens to share a shorter or similar
name. Using anything other than the exact given name risks promoting the
wrong thing.

FOLLOW-UPS:
If this is a follow-up (step > 0), keep it brief, reference that you wrote
before without repeating it verbatim, and add ONE new, small, genuine reason
to reply — never guilt, pressure, or repetition of the same pitch.

DO NOT INCLUDE:
- a signature, sign-off name, company postal address, or unsubscribe text —
  these are appended separately and automatically; adding your own would
  duplicate them.

IF YOU DO INCLUDE ANY CLOSING LINE ANYWAY (e.g. "Best regards,"):
This has gone wrong before — a placeholder like "[Your Name]" was sent to
a real person. If a closing appears at all, it must be signed with the
exact name "Innocent Mwangi" — never a placeholder, never any other name,
never left blank. But the strong preference is still to omit a closing
entirely per the rule above.

OUTPUT FORMAT:
Respond with ONLY a JSON object, no markdown fences, no extra commentary,
in ONE of these two shapes:

{"action": "compose", "subject": "...", "body": "..."}

or

{"action": "request_info", "reason": "one or two sentences explaining what's missing, for Innocent to read"}

For "reason": this has been genuinely confusing before — a message like
"I couldn't find detailed information on their website" is ambiguous
about whose website you mean (the prospect's, or the product's own).
Always name the product explicitly and make it unambiguous that the gap
is in Innocent's own product intelligence, not anything about the
prospect. Write it the way you'd want it read by someone skimming a list
of alerts: e.g. "UHIKO Properties: couldn't find enough on
uhiko.com itself to write a specific, credible email — the page may be
JavaScript-rendered or the listings may live on subpages I didn't check."
`.trim();

export interface ComposeEmailInput {
  prospect: Prospect;
  product: Product;
  step: number;
  previousSends: EmailSend[];
}

export type ComposeEmailResult =
  | { action: "compose"; subject: string; body: string }
  | { action: "request_info"; reason: string };

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
  if (product.url) {
    lines.push(`- URL: ${product.url}`);
  } else {
    lines.push(`- URL: none on file`);
  }

  const richFieldCount = [product.problem, product.audience, product.positioning, product.features]
    .filter(Boolean).length;

  if (richFieldCount <= 1 && product.url) {
    lines.push("");
    lines.push(
      `NOTE: this product's stored intelligence is thin. Visit ${product.url} yourself before writing.`
    );
  }

  if (previousSends.length > 0) {
    lines.push("");
    lines.push("PREVIOUS EMAILS ALREADY SENT IN THIS SEQUENCE (do not repeat):");
    for (const send of previousSends) {
      lines.push(`- Step ${send.step} subject: "${send.subject}"`);
    }
  }

  return lines.join("\n");
}

function parseComposedEmail(raw: string): ComposeEmailResult {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Email composer returned non-JSON output.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Email composer output was not a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.action === "request_info") {
    if (typeof obj.reason !== "string" || !obj.reason.trim()) {
      throw new Error('request_info output missing a "reason".');
    }
    return { action: "request_info", reason: obj.reason.trim() };
  }

  if (obj.action === "compose") {
    if (typeof obj.subject !== "string" || typeof obj.body !== "string") {
      throw new Error('Email composer output missing "subject" or "body".');
    }
    const subject = obj.subject.trim();
    const body = obj.body.trim();
    if (!subject || !body) {
      throw new Error("Email composer returned an empty subject or body.");
    }
    return { action: "compose", subject, body };
  }

  throw new Error(`Email composer returned an unrecognized action: ${String(obj.action)}`);
}

export async function composeOutreachEmail(
  input: ComposeEmailInput
): Promise<ComposeEmailResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set — cannot compose email content.");
  }

  const agent = new Agent({
    name: "Email Composer",
    model: MODEL,
    instructions: SYSTEM_PROMPT,
    tools: [webSearchTool()],
  });

  const result = await run(agent, buildUserPrompt(input), {
    maxTurns: MAX_TURNS,
  });

  const usage = result.state.usage;
  await recordApiUsage({
    user_id: LOCAL_USER_ID,
    source: "email_compose",
    model: MODEL,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });

  const raw = result.finalOutput;

  if (!raw) {
    throw new Error("Email composer returned no output.");
  }

  return parseComposedEmail(raw);
}
