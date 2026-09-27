import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { processInboundWebhookMessage } from "@/lib/email/inboundProcessor";
import { logActivity } from "@/lib/models/activity";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4G — the actual fix for "Check Inbox has never worked".
 *
 * IMAP polling from Vercel kept failing at the socket level — Vercel's
 * serverless functions don't have a fixed outbound IP, and the mail
 * server very likely blocks/rate-limits connections from unfamiliar,
 * changing IPs. This sidesteps that class of problem entirely: instead
 * of Vercel repeatedly reaching out to the mail server, the mail
 * server (via Resend) pushes replies to Vercel as an ordinary,
 * inbound HTTPS request. No outbound connection, no IP to block.
 *
 * Resend webhooks are delivered via Svix — verified using the official
 * SDK, which requires the RAW request body (not re-parsed JSON) and the
 * three svix-* headers. See https://resend.com/docs/webhooks/verify-webhooks-requests
 */

/** Crude but safe HTML->text fallback for the rare case a message has
 * html but no plain-text part. Good enough for classification and reply
 * composition, which is all this text is used for downstream. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extracts a bare email address from a "Name <email@x.com>" or plain
 * "email@x.com" from-field format — matching what the rest of the
 * inbound pipeline expects (a bare address, same as imapClient produces). */
function extractBareAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * MILESTONE 8U — a direct response to a real, confirmed gap: two real
 * inbound replies vanished completely, with zero trace anywhere —
 * not in inbound_emails, not in the activity log, nothing. Tracing
 * through this handler found why: every early-exit failure path
 * (missing signature headers, bad signature, missing config, failure
 * to fetch the email body) returns straight to Resend without ever
 * calling logActivity — only the one outer catch-all did. If any of
 * these specific paths is what's actually happening, it was
 * genuinely invisible before this. This helper makes every one of
 * them leave a real trace.
 */
async function logWebhookFailure(message: string): Promise<void> {
  try {
    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: null,
      event_type: "TASK_FAILED",
      message: `Inbound email webhook rejected the request: ${message}`,
    });
  } catch (logError) {
    console.error("[resend-inbound] Also failed to log the failure:", logError);
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.text();

    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      await logWebhookFailure("Missing Svix headers on the incoming request.");
      return NextResponse.json({ error: "Missing Svix headers." }, { status: 400 });
    }

    if (!process.env.RESEND_WEBHOOK_SECRET) {
      console.error("[resend-inbound] RESEND_WEBHOOK_SECRET is not set — cannot verify webhook.");
      await logWebhookFailure("RESEND_WEBHOOK_SECRET is not configured.");
      return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
    }
    if (!process.env.RESEND_API_KEY) {
      console.error("[resend-inbound] RESEND_API_KEY is not set — cannot fetch email content.");
      await logWebhookFailure("RESEND_API_KEY is not configured.");
      return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    let event;
    try {
      event = resend.webhooks.verify({
        payload,
        headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
      });
    } catch (error) {
      console.error("[resend-inbound] Signature verification failed:", error);
      await logWebhookFailure(
        `Signature verification failed: ${error instanceof Error ? error.message : String(error)}.`
      );
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }

    if (event.type !== "email.received") {
      // Other event types (delivered, bounced, complained) aren't
      // relevant here since outbound sending doesn't go through Resend
      // — only inbound receiving does. Acknowledge and ignore.
      return NextResponse.json({ ignored: event.type });
    }

    const emailId = (event.data as { email_id?: string })?.email_id;
    const webhookMessageId = (event.data as { message_id?: string })?.message_id ?? null;

    if (!emailId) {
      await logWebhookFailure("No email_id in the event payload.");
      return NextResponse.json({ error: "No email_id in event payload." }, { status: 400 });
    }

    const { data: email, error: fetchError } = await resend.emails.receiving.get(emailId);

    if (fetchError || !email) {
      console.error("[resend-inbound] Could not fetch email content:", fetchError);
      await logWebhookFailure(
        `Could not fetch email content for email_id ${emailId}: ${fetchError ? JSON.stringify(fetchError) : "no email returned"}.`
      );
      return NextResponse.json({ error: "Could not fetch email content." }, { status: 502 });
    }

    const headers = (email as { headers?: Record<string, string> }).headers ?? {};
    const autoSubmittedHeader = headers["auto-submitted"] ?? headers["Auto-Submitted"];
    const isAutoSubmitted = Boolean(
      autoSubmittedHeader && String(autoSubmittedHeader).toLowerCase() !== "no"
    );

    const rawText = (email as { text?: string | null }).text;
    const rawHtml = (email as { html?: string | null }).html;
    const text = rawText && rawText.trim().length > 0 ? rawText : rawHtml ? htmlToText(rawHtml) : "";

    await processInboundWebhookMessage({
      uid: Date.now(),
      messageId: webhookMessageId,
      fromAddress: extractBareAddress(email.from ?? ""),
      subject: email.subject ?? "(no subject)",
      text,
      isAutoSubmitted,
    });

    return NextResponse.json({ processed: true });
  } catch (error) {
    console.error("[resend-inbound] Webhook processing failed:", error);
    try {
      await logActivity({
        user_id: LOCAL_USER_ID,
        task_id: null,
        event_type: "TASK_FAILED",
        message: `Inbound email webhook failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    } catch {
      // Never let a logging failure mask the original error.
    }
    // Still return 200 — Resend will retry on non-2xx, and if this is a
    // genuine, repeatable failure (not a transient one), retries won't
    // help and would just accumulate. The activity log above is what
    // actually surfaces this for a person to see.
    return NextResponse.json({ error: "Processing failed, logged." });
  }
}
