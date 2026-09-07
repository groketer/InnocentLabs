/**
 * MILESTONE 3F — Follow-up campaigns.
 *
 * Actual outbound email delivery via SMTP (nodemailer), using the
 * SMTP_* environment variables that were already present in .env.example
 * from the very start of this project, unused until now.
 *
 * IMPORTANT — compliance footer:
 * appendComplianceFooter() is called unconditionally by sendEmail() below.
 * There is no code path that sends an email without it. Under CAN-SPAM
 * (and as a baseline of basic decency regardless of jurisdiction), every
 * commercial email needs honest sender identification, a real postal
 * address, and a working, immediately-effective unsubscribe mechanism.
 * This is enforced here, at the transport layer, specifically so that no
 * future change to how email content is composed (AI-generated or
 * otherwise) can accidentally omit it.
 */

import nodemailer from "nodemailer";

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body WITHOUT the compliance footer — appendComplianceFooter() adds it. */
  body: string;
  unsubscribeToken: string;
  /**
   * The prospect's actual name, if known — used by the placeholder
   * backstop below to fix a greeting the composer left as a literal
   * bracketed placeholder instead of either the real name or a generic
   * greeting. Optional because not every send has a clearly known
   * individual (an organization-only prospect has no personal name).
   */
  recipientName?: string;
  /**
   * For a reply: the Message-ID of the email being replied to, so it
   * threads correctly in the recipient's inbox instead of showing up as
   * an unrelated new message.
   */
  inReplyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  finalBody: string;
  errorMessage?: string;
  /** The Message-ID nodemailer generated for this send, if it succeeded — needed to thread a future reply-to-this-reply. */
  messageId?: string;
}

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD
  );
}

function unsubscribeUrl(token: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");

  if (!base) {
    // No APP_BASE_URL configured — this is a real problem (an email with a
    // broken unsubscribe link should not go out), surfaced as an error by
    // sendEmail() rather than silently sending a dead link.
    throw new Error(
      "APP_BASE_URL is not set — cannot build a working unsubscribe link. Set it in your environment variables before sending campaigns."
    );
  }

  // This exact misconfiguration shipped real emails with a
  // http://localhost:3000/unsubscribe/... link — completely unreachable
  // for the recipient, and a real compliance problem, not just a cosmetic
  // one. If we're genuinely running on Vercel (not local dev) and
  // APP_BASE_URL still points at localhost/127.0.0.1, that's someone's
  // local-dev value left in production by mistake — refuse to send rather
  // than repeat the mistake silently.
  if (process.env.VERCEL && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(base)) {
    throw new Error(
      `APP_BASE_URL is set to "${base}", which is a local-dev address, but this is running on Vercel. ` +
        `Set APP_BASE_URL to your real deployed URL (e.g. https://your-app.vercel.app) in Vercel's environment variables.`
    );
  }

  return `${base}/unsubscribe/${token}`;
}

export function appendComplianceFooter(
  body: string,
  unsubscribeToken: string
): string {
  const fromName = process.env.SMTP_FROM_NAME?.trim() || "Innocent Labs";
  const postalAddress = process.env.SENDER_POSTAL_ADDRESS?.trim();

  const footerLines = [
    "",
    "--",
    fromName,
    postalAddress || "[No sender postal address configured — set SENDER_POSTAL_ADDRESS]",
    "",
    `Don't want to hear from us again? Unsubscribe: ${unsubscribeUrl(unsubscribeToken)}`,
  ];

  return `${body}\n${footerLines.join("\n")}`;
}

/**
 * Hard, code-level backstops for two real incidents:
 *
 * 1. A composer generated "Best regards, [Your Name]" and it was sent to
 *    a real person. Fixed at the prompt level (both composers now say to
 *    always sign as "Innocent Mwangi" if a closing appears at all), but a
 *    prompt instruction is never a 100% guarantee — this catches the
 *    literal placeholder regardless.
 *
 * 2. A composer generated "Dear [Recipient's Name]," when it had no
 *    individual contact name for an organization-type prospect. Same
 *    pattern: fixed at the prompt level, backstopped here.
 *
 * Both are applied unconditionally to every outgoing body, so neither
 * failure mode can recur even if a future prompt change weakens the
 * instruction that's supposed to prevent it in the first place.
 */
const SENDER_PLACEHOLDER_PATTERN = /\[(your name|sender name)\]/gi;
const SENDER_DISPLAY_NAME = "Innocent Mwangi";

// Matches a greeting line ("Dear X," / "Hi X," / "Hello X,") where X is a
// bracketed placeholder, however it's worded — [Recipient's Name],
// [Recipient Name], [Prospect Name], [Client Name], [First Name], etc.
const GREETING_PLACEHOLDER_PATTERN = /\b(Dear|Hi|Hello)\s+\[[^\]]*\]\s*,/gi;

// Any other bracketed placeholder containing the word "name" that wasn't
// part of a recognized greeting line above — a final catch-all.
const GENERIC_NAME_PLACEHOLDER_PATTERN = /\[[^\]]*\bname\b[^\]]*\]/gi;

export function fixNamePlaceholders(
  body: string,
  recipientName?: string
): string {
  let result = body.replace(SENDER_PLACEHOLDER_PATTERN, SENDER_DISPLAY_NAME);

  result = result.replace(GREETING_PLACEHOLDER_PATTERN, (match, greetingWord) =>
    recipientName ? `${greetingWord} ${recipientName},` : "Hi there,"
  );

  result = result.replace(
    GENERIC_NAME_PLACEHOLDER_PATTERN,
    recipientName ?? "there"
  );

  return result;
}

/**
 * Hard, code-level backstop for a third real incident: composeEmail.ts
 * now has a live web search tool, and the model sometimes carries its own
 * inline citation markup — "(text)([site.com](url))" or plain markdown
 * links "[text](url)" — straight into the final output. These emails are
 * sent as plain text, not HTML, so markdown link syntax never renders;
 * it just shows up as broken literal brackets and parentheses to a real
 * recipient. Fixed at the prompt level (explicit instruction never to
 * include citation markup or markdown links), backstopped here.
 */
const CITATION_ARTIFACT_PATTERN = /\s*\(\[[^\]]+\]\([^)]+\)\)/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

export function stripMarkdownArtifacts(body: string): string {
  let result = body.replace(CITATION_ARTIFACT_PATTERN, "");
  result = result.replace(MARKDOWN_LINK_PATTERN, "$1");
  return result;
}

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return cachedTransporter;
}

function bccRecipients(): string[] {
  const raw = process.env.BCC_NOTIFICATION_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((addr) => addr.trim())
    .filter(Boolean);
}

export async function sendEmail(
  input: SendEmailInput
): Promise<SendEmailResult> {
  if (!isSmtpConfigured()) {
    return {
      success: false,
      finalBody: input.body,
      errorMessage:
        "SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD missing) — cannot send email.",
    };
  }

  let finalBody: string;
  try {
    finalBody = appendComplianceFooter(
      fixNamePlaceholders(
        stripMarkdownArtifacts(input.body),
        input.recipientName
      ),
      input.unsubscribeToken
    );
  } catch (error) {
    return {
      success: false,
      finalBody: input.body,
      errorMessage:
        error instanceof Error ? error.message : "Could not build compliance footer.",
    };
  }

  const fromName = process.env.SMTP_FROM_NAME?.trim() || "Innocent Labs";
  const bcc = bccRecipients();

  try {
    const info = await getTransporter().sendMail({
      from: `"${fromName}" <${process.env.SMTP_USER}>`,
      to: input.to,
      ...(bcc.length > 0 ? { bcc } : {}),
      subject: input.subject,
      text: finalBody,
      ...(input.inReplyTo
        ? { inReplyTo: input.inReplyTo, references: input.inReplyTo }
        : {}),
    });

    return { success: true, finalBody, messageId: info.messageId };
  } catch (error) {
    return {
      success: false,
      finalBody,
      errorMessage: error instanceof Error ? error.message : "Send failed.",
    };
  }
}
