import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6L — resolving a genuinely decisive, blocking question
 * before building a bounce-webhook fix that only makes sense if this is
 * true: is outbound email actually routed through Resend's own SMTP
 * relay, or a different provider entirely? A hostname is not a secret
 * (unlike SMTP_USER/SMTP_PASSWORD, deliberately never touched here) —
 * safe to reveal directly rather than guess from a blank Vercel edit
 * field, which only hides sensitive-flagged values, not proof of
 * absence.
 */
export async function GET(_req: NextRequest) {
  const host = process.env.SMTP_HOST ?? null;
  const port = process.env.SMTP_PORT ?? null;

  return noCacheJson({
    smtpHostIsSet: !!host,
    smtpHost: host,
    smtpPort: port,
    isResendRelay: host ? host.toLowerCase().includes("resend") : null,
    note: host
      ? "SMTP_HOST has a real value — the blank Vercel edit field was just its sensitive-value masking, not a sign it's missing."
      : "SMTP_HOST genuinely appears unset in this environment — but if emails have been sending successfully, double check this route is reading the same environment as production (e.g. Preview vs Production env vars can differ).",
  });
}
