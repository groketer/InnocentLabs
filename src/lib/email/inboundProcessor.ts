/**
 * MILESTONE 3J — Inbound email.
 *
 * For each unseen message in the inbox, in order:
 * 1. Auto-submitted (vacation responder etc.) → log and skip. Replying to
 *    an auto-responder is the classic way these systems create infinite
 *    bot-to-bot loops — never reply to one, ever.
 * 2. Looks like a bounce → find which of our prospects it's about, mark
 *    them "bounced" (no more sends, ever, to that address), log it.
 * 3. From a known, active prospect → this is a genuine reply. Check the
 *    per-conversation safety cap, then let composeReply() decide whether
 *    to reply autonomously or escalate for Innocent to handle personally.
 * 4. From an unrecognized sender → log it as unmatched. Take no action —
 *    this could be anything (a wrong number, spam, a newsletter reply)
 *    and there's no prospect record to attach a decision to.
 *
 * Every message is recorded exactly once (idempotent via the unique
 * index on inbound_emails.message_id), regardless of how it's handled.
 */

import { fetchUnseenMessages, isImapConfigured, INBOX_CHECK_BATCH_SIZE } from "./imapClient";
import { looksLikeBounce, extractBouncedAddress } from "./bounceDetection";
import { composeReply } from "./composeReply";
import { sendEmail } from "./sendEmail";
import { notifyOwner } from "./notifyOwner";
import {
  getProspectByEmail,
  listAllProspectEmails,
  updateProspectSequence,
  findProspectByDomain,
  type Prospect,
} from "@/lib/models/prospects";
import { getProductById } from "@/lib/models/products";
import {
  recordEmailSend,
  listSendsForProspect,
  getLatestSendForProspect,
  countRepliesForProspect,
} from "@/lib/models/emailSends";
import { recordInboundEmail } from "@/lib/models/inboundEmails";
import { logActivity } from "@/lib/models/activity";
import { getSettings } from "@/lib/models/settings";
import { LOCAL_USER_ID } from "@/lib/localUser";

/**
 * MILESTONE 3L — improvement #3: escalation notifications.
 *
 * needs_human_reply is the one status in this whole system that's
 * designed to need Innocent's timely attention — everything else here is
 * genuinely autonomous. Without this, it just sat quietly in Follow-ups
 * until he happened to check. This is the single choke point every
 * escalation path below goes through, so the notification can never be
 * forgotten at one call site and not another.
 */
async function escalateToHuman(
  prospect: Prospect,
  reason: string
): Promise<void> {
  await updateProspectSequence(LOCAL_USER_ID, prospect.id, {
    sequence_status: "needs_human_reply",
  });

  await logActivity({
    user_id: LOCAL_USER_ID,
    task_id: null,
    event_type: "TASK_NEEDS_INPUT",
    message: `${prospect.name} needs your personal reply: ${reason}`,
  });

  await notifyOwner(
    `${prospect.name} needs your reply`,
    `${prospect.name}${prospect.organization ? ` (${prospect.organization})` : ""} needs your personal attention:\n\n${reason}\n\nOpen Follow-ups in the app to see the full conversation and respond.`
  );
}

/**
 * Checks the inbox once and processes everything currently unread.
 * Safe to call frequently — a no-op in well under a second if IMAP isn't
 * configured or there's nothing new.
 */
export async function processInboundEmail(): Promise<{ processed: number; batchWasFull: boolean }> {
  if (!isImapConfigured()) {
    return { processed: 0, batchWasFull: false };
  }

  const settings = await getSettings();

  if (!settings.autonomous_replies) {
    return { processed: 0, batchWasFull: false };
  }

  let messages;
  try {
    messages = await fetchUnseenMessages();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[inboundProcessor] Could not check inbox:", error);
    // MILESTONE 3X — this used to be console-only, meaning a real,
    // ongoing failure (e.g. the timeout this batch-size fix addresses)
    // was completely invisible in the app itself — nobody checks
    // Vercel's function logs day to day. Now it shows up in Activity,
    // where it's actually seen.
    try {
      await logActivity({
        user_id: LOCAL_USER_ID,
        task_id: null,
        event_type: "TASK_FAILED",
        message: `Inbox check failed: ${message}`,
      });
    } catch {
      // Never let a logging failure mask the original error path.
    }
    return { processed: 0, batchWasFull: false };
  }

  if (messages.length === 0) {
    return { processed: 0, batchWasFull: false };
  }

  const knownEmails = await listAllProspectEmails(LOCAL_USER_ID);

  for (const message of messages) {
    try {
      await processOneMessage(message, knownEmails, settings);
    } catch (error) {
      console.error(
        "[inboundProcessor] Failed to process one inbound message:",
        error
      );
    }
  }

  return { processed: messages.length, batchWasFull: messages.length >= INBOX_CHECK_BATCH_SIZE };
}

/**
 * MILESTONE 4G — the webhook-based inbound path (Resend).
 *
 * Same processing logic as the IMAP path above — classification, bounce
 * handling, reply composition, escalation — applied to a single message
 * that arrived via webhook instead of being fetched by polling. This is
 * what makes the webhook route thin: it only needs to shape a Resend
 * payload into a FetchedInboundMessage and call this.
 */
export async function processInboundWebhookMessage(
  message: Awaited<ReturnType<typeof fetchUnseenMessages>>[number]
): Promise<void> {
  const settings = await getSettings();

  if (!settings.autonomous_replies) {
    return;
  }

  const knownEmails = await listAllProspectEmails(LOCAL_USER_ID);
  await processOneMessage(message, knownEmails, settings);
}

async function processOneMessage(
  message: Awaited<ReturnType<typeof fetchUnseenMessages>>[number],
  knownEmails: Set<string>,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<void> {
  // 1. Never reply to an auto-responder — the classic bot-loop trap.
  if (message.isAutoSubmitted) {
    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "auto_reply",
      handled: "skipped",
      note: "Declared itself an automated response (Auto-Submitted header) — never replied to.",
    });
    return;
  }

  // 2. Bounce handling.
  if (looksLikeBounce({ fromAddress: message.fromAddress, subject: message.subject, text: message.text })) {
    const bouncedAddress = extractBouncedAddress(message.text, knownEmails);
    const prospect = bouncedAddress
      ? await getProspectByEmail(LOCAL_USER_ID, bouncedAddress)
      : null;

    if (prospect) {
      await updateProspectSequence(LOCAL_USER_ID, prospect.id, {
        sequence_status: "bounced",
        next_send_at: null,
      });
      await logActivity({
        user_id: LOCAL_USER_ID,
        task_id: null,
        event_type: "TASK_COMPLETED",
        message: `${prospect.name}'s email bounced — marked bounced, no further emails will be sent to them.`,
      });
    }

    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect?.id ?? null,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "bounce",
      handled: prospect ? "skipped" : "skipped",
      note: prospect
        ? `Matched to ${prospect.name}.`
        : "Could not confidently match this bounce to a known prospect.",
    });
    return;
  }

  // 3. Genuine reply from a known prospect?
  const prospect = await getProspectByEmail(LOCAL_USER_ID, message.fromAddress);

  if (!prospect) {
    // MILESTONE 3L — improvement #5: don't just silently lose this. If
    // the sender's domain matches a known prospect's domain (e.g. they
    // replied from a personal address instead of the one on file), flag
    // it as a possible match for a person to review — never auto-link,
    // since sending an autonomous reply into the wrong person's
    // conversation context is a real, meaningful risk, and this is
    // exactly the situation where getting it wrong would be worst.
    const senderDomain = message.fromAddress.split("@")[1]?.toLowerCase();
    const possibleMatch = senderDomain
      ? await findProspectByDomain(LOCAL_USER_ID, senderDomain)
      : null;

    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "unmatched",
      handled: "skipped",
      note: possibleMatch
        ? `Sender does not match any known prospect exactly, but the domain matches ${possibleMatch.name} (${possibleMatch.email}) — possibly the same person replying from a different address. Not auto-linked; review manually.`
        : "Sender does not match any known prospect.",
    });
    return;
  }

  // A reply from someone who already unsubscribed or bounced doesn't
  // reopen anything — still logged, but no action taken.
  if (["unsubscribed", "bounced"].includes(prospect.sequence_status)) {
    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect.id,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "reply",
      handled: "skipped",
      note: `Prospect's sequence is "${prospect.sequence_status}" — not reopening.`,
    });
    return;
  }

  // Safety cap: hard technical backstop regardless of what the AI would
  // otherwise decide, to prevent a runaway back-and-forth.
  const replyCount = await countRepliesForProspect(prospect.id);
  if (replyCount >= settings.max_autonomous_replies_per_conversation) {
    await escalateToHuman(
      prospect,
      `Reached the ${settings.max_autonomous_replies_per_conversation}-reply safety cap for one conversation.`
    );
    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect.id,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "reply",
      handled: "escalated",
      note: `Reached the ${settings.max_autonomous_replies_per_conversation}-reply safety cap for one conversation — flagged for Innocent.`,
    });
    return;
  }

  const product = prospect.product_id
    ? await getProductById(prospect.product_id)
    : null;
  const history = await listSendsForProspect(prospect.id);

  let decision;
  try {
    decision = await composeReply({
      prospect,
      product,
      history,
      inboundSubject: message.subject,
      inboundText: message.text,
    });
  } catch (error) {
    // Composition failure is treated the same as escalation — never leave
    // someone's reply completely unaddressed just because generation
    // failed once.
    const reason = `Could not compose a reply automatically: ${error instanceof Error ? error.message : "unknown error"}.`;
    await escalateToHuman(prospect, reason);
    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect.id,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "reply",
      handled: "escalated",
      note: reason,
    });
    return;
  }

  if (decision.action === "escalate") {
    await escalateToHuman(prospect, decision.reason);
    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect.id,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "reply",
      handled: "escalated",
      note: decision.reason,
    });
    return;
  }

  if (decision.action === "unsubscribe") {
    // The actual fix for a real incident: this must genuinely unsubscribe
    // the prospect, not just send a message saying it will happen. The
    // acknowledgment reply and the real database change happen together —
    // never one without the other.
    const unsubscribeToken = prospect.unsubscribe_token ?? undefined;

    await updateProspectSequence(LOCAL_USER_ID, prospect.id, {
      sequence_status: "unsubscribed",
      next_send_at: null,
    });

    if (unsubscribeToken) {
      const sendResult = await sendEmail({
        to: prospect.email as string,
        subject: `Re: ${message.subject}`,
        body: decision.acknowledgment,
        unsubscribeToken,
        recipientName: prospect.prospect_type === "person" ? prospect.name : undefined,
        inReplyTo: message.messageId ?? undefined,
      });

      if (sendResult.success) {
        await recordEmailSend({
          user_id: LOCAL_USER_ID,
          prospect_id: prospect.id,
          step: 0,
          subject: `Re: ${message.subject}`,
          body: sendResult.finalBody,
          status: "sent",
          direction: "reply",
          message_id: sendResult.messageId,
          in_reply_to: message.messageId ?? undefined,
        });
      }
    }

    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect.id,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "reply",
      handled: "replied",
      note: "Unsubscribe request detected and processed automatically.",
    });

    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: null,
      event_type: "TASK_COMPLETED",
      message: `${prospect.name} asked to be unsubscribed — done automatically.`,
    });

    return;
  }

  // decision.action === "reply"
  const latestSend = await getLatestSendForProspect(prospect.id);
  const unsubscribeToken = prospect.unsubscribe_token ?? undefined;

  if (!unsubscribeToken) {
    // Shouldn't normally happen (a prospect who's received outreach
    // already has one), but never send without a working unsubscribe link.
    const reason = "Prospect has no unsubscribe token on file — cannot send a compliant reply automatically.";
    await escalateToHuman(prospect, reason);
    await recordInboundEmail({
      user_id: LOCAL_USER_ID,
      prospect_id: prospect.id,
      message_id: message.messageId,
      from_address: message.fromAddress,
      subject: message.subject,
      body: message.text,
      classification: "reply",
      handled: "escalated",
      note: reason,
    });
    return;
  }

  const sendResult = await sendEmail({
    to: prospect.email as string,
    subject: decision.subject,
    body: decision.body,
    unsubscribeToken,
    recipientName: prospect.prospect_type === "person" ? prospect.name : undefined,
    inReplyTo: message.messageId ?? latestSend?.message_id,
  });

  await recordEmailSend({
    user_id: LOCAL_USER_ID,
    prospect_id: prospect.id,
    step: replyCount,
    subject: decision.subject,
    body: sendResult.finalBody,
    status: sendResult.success ? "sent" : "failed",
    error_message: sendResult.errorMessage,
    direction: "reply",
    message_id: sendResult.messageId,
    in_reply_to: message.messageId ?? undefined,
  });

  await recordInboundEmail({
    user_id: LOCAL_USER_ID,
    prospect_id: prospect.id,
    message_id: message.messageId,
    from_address: message.fromAddress,
    subject: message.subject,
    body: message.text,
    classification: "reply",
    handled: sendResult.success ? "replied" : "escalated",
    note: sendResult.success ? undefined : sendResult.errorMessage,
  });

  if (sendResult.success) {
    await updateProspectSequence(LOCAL_USER_ID, prospect.id, {
      sequence_status: "in_conversation",
      next_send_at: null,
    });
    await logActivity({
      user_id: LOCAL_USER_ID,
      task_id: null,
      event_type: "TASK_COMPLETED",
      message: `Replied to ${prospect.name} automatically.`,
    });
  } else {
    await escalateToHuman(
      prospect,
      `The reply failed to send: ${sendResult.errorMessage ?? "unknown error"}.`
    );
  }
}
