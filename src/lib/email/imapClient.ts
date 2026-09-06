/**
 * MILESTONE 3J — Inbound email.
 *
 * Reads the SAME mailbox the SMTP sending config points at, via IMAP
 * (the standard protocol for reading email — this is exactly what your
 * phone's Mail app uses). This is deliberately NOT a website feature:
 * your website doesn't receive your email, your mail server does, so
 * checking that mailbox directly is the only sensible way to see
 * replies and bounces.
 *
 * Only ever reads and marks messages \Seen — never deletes or modifies
 * anything else in the mailbox.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export interface FetchedInboundMessage {
  uid: number;
  messageId: string | null;
  fromAddress: string;
  subject: string;
  text: string;
  /** True if the message declares itself as an automated response (vacation responder, etc.) via the Auto-Submitted header. */
  isAutoSubmitted: boolean;
}

export function isImapConfigured(): boolean {
  return Boolean(
    process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD
  );
}

async function connect(): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST as string,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: process.env.IMAP_SECURE !== "false",
    auth: {
      user: process.env.IMAP_USER as string,
      pass: process.env.IMAP_PASSWORD as string,
    },
    logger: false,
  });

  await client.connect();
  return client;
}

/**
 * Fetches every currently-unread message in the inbox and marks each one
 * \Seen as it's read, so a later call never sees the same message twice.
 * If IMAP isn't configured, returns an empty list rather than throwing —
 * this feature is entirely optional infrastructure on top of everything
 * else, not something that should ever break the rest of the app.
 */
export async function fetchUnseenMessages(): Promise<FetchedInboundMessage[]> {
  if (!isImapConfigured()) {
    return [];
  }

  const messages: FetchedInboundMessage[] = [];
  const client = await connect();

  try {
    const lock = await client.getMailboxLock("INBOX");

    try {
      for await (const msg of client.fetch(
        { seen: false },
        { source: true, uid: true }
      )) {
        if (!msg.source) continue;

        const parsed = await simpleParser(msg.source);

        const fromAddress =
          parsed.from?.value?.[0]?.address?.toLowerCase().trim() ?? "";

        const autoSubmittedHeader = parsed.headers.get("auto-submitted");
        const isAutoSubmitted = Boolean(
          autoSubmittedHeader &&
            String(autoSubmittedHeader).toLowerCase() !== "no"
        );

        messages.push({
          uid: msg.uid,
          messageId: parsed.messageId ?? null,
          fromAddress,
          subject: parsed.subject ?? "(no subject)",
          text: parsed.text ?? "",
          isAutoSubmitted,
        });

        await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return messages;
}
