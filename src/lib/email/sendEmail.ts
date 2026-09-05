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
}

export interface SendEmailResult {
  success: boolean;
  finalBody: string;
  errorMessage?: string;
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
    finalBody = appendComplianceFooter(input.body, input.unsubscribeToken);
  } catch (error) {
    return {
      success: false,
      finalBody: input.body,
      errorMessage:
        error instanceof Error ? error.message : "Could not build compliance footer.",
    };
  }

  const fromName = process.env.SMTP_FROM_NAME?.trim() || "Innocent Labs";

  try {
    await getTransporter().sendMail({
      from: `"${fromName}" <${process.env.SMTP_USER}>`,
      to: input.to,
      subject: input.subject,
      text: finalBody,
    });

    return { success: true, finalBody };
  } catch (error) {
    return {
      success: false,
      finalBody,
      errorMessage: error instanceof Error ? error.message : "Send failed.",
    };
  }
}
