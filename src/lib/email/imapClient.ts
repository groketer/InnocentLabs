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

// Bounded per check so a large backlog is cleared incrementally across
// several checks rather than causing every single check to time out
// trying to process all of it at once. Kept deliberately small — Vercel's
// free/Hobby tier hard-caps function execution at 10 seconds regardless
// of any maxDuration set in code, and connecting, fetching, and parsing
// each message via IMAP is real, variable-latency work, not something
// safe to assume completes quickly. 10 is conservative on purpose.
export const INBOX_CHECK_BATCH_SIZE = 10;

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
    // MILESTONE 3Z-5 — a real bug this fixes, found directly in
    // production logs: ImapFlow's own default connectionTimeout is
    // 90 seconds, longer than Vercel's 60-second function limit. That
    // means a slow or unreachable mail server never got a chance to
    // fail on its own terms — Vercel just killed the function first,
    // every single time, burning the full budget with no clean error.
    // These are deliberately short: a working mail server responds in
    // a few seconds, not tens of seconds, so failing fast here is a
    // real fix, not just a tighter number.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  // MILESTONE 3Z-7 — the actual root cause, found directly from a real
  // "Uncaught Exception: Socket timeout" in production logs, not
  // guessed: ImapFlow is an EventEmitter, and when its underlying TLS
  // socket has a problem (like a timeout) after the main operation has
  // already moved on, it emits an 'error' event. Node's EventEmitter has
  // a hard rule: an 'error' event with no registered listener is thrown
  // as an uncaught exception — capable of crashing the entire process,
  // not just failing the one IMAP operation in flight. This had no
  // listener at all. Registering one, even just to log, is what stops a
  // stray socket problem from taking down the whole serverless instance.
  client.on("error", (err) => {
    console.warn("[imapClient] Socket-level error (contained, not fatal):", err);
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
      // MILESTONE 3X — a real incident this fixes: a backlog of unread
      // messages (bounces piling up unprocessed) meant every check tried
      // to fetch and parse the ENTIRE backlog in one serverless function
      // invocation, exceeded the execution time limit, and timed out —
      // making zero progress, every single time, forever, since nothing
      // ever got marked \Seen. Capping how many get processed per check
      // means every run makes real, bounded progress regardless of how
      // large the backlog is; a big backlog just takes several checks to
      // clear rather than never clearing at all.
      const uids = await client.search({ seen: false }, { uid: true });
      const batch = (uids || []).slice(0, INBOX_CHECK_BATCH_SIZE);

      if (batch.length === 0) {
        return [];
      }

      for await (const msg of client.fetch(
        batch,
        { source: true, uid: true },
        { uid: true }
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
