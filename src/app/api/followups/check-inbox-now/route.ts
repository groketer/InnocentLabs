import { NextResponse } from "next/server";
import { processInboundEmail } from "@/lib/email/inboundProcessor";
import { isImapConfigured } from "@/lib/email/imapClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * MILESTONE 3X — a direct, on-demand way to check the inbox right now
 * and see the real result immediately, rather than waiting on the
 * throttled background check (which, without frequent external ticking,
 * might only run once a day) and having no visibility into whether it
 * even succeeded.
 */
export async function POST() {
  if (!isImapConfigured()) {
    return NextResponse.json(
      { error: "IMAP is not configured — IMAP_HOST/IMAP_USER/IMAP_PASSWORD are missing." },
      { status: 400 }
    );
  }

  try {
    const result = await processInboundEmail();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[api/followups/check-inbox-now] POST failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Inbox check failed." },
      { status: 500 }
    );
  }
}
