import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { tick } from "@/lib/taskEngine/engine";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Locally, this is a dev/testing convenience only — the engine already
 * ticks on its own every few seconds via the in-process setInterval loop
 * (see src/lib/taskEngine/engine.ts).
 *
 * On Vercel, there IS no in-process loop (serverless functions can't keep
 * one alive), so this route is load-bearing: it's what the client-side
 * EngineTicker (see src/components/EngineTicker.tsx) calls every few
 * seconds while the app is open to actually advance tasks. It's also hit
 * once daily by /api/cron/daily as a backstop, and — for genuine 24/7
 * operation, independent of anyone having the app open — can be hit every
 * minute or so by an Upstash QStash schedule (see .env.example for the
 * signing keys this needs).
 *
 * AUTH: this route is deliberately excluded from the APP_PASSWORD
 * middleware gate (see src/middleware.ts's matcher) because QStash can't
 * send a session cookie. Instead it accepts EITHER:
 *   - a valid QStash signature (upstash-signature header), verified below, OR
 *   - a valid session cookie (the same check the middleware would have
 *     done), so the browser-based EngineTicker keeps working exactly as
 *     before.
 * If APP_PASSWORD isn't set at all, the app is ungated and this allows
 * any request through, same as everywhere else.
 *
 * Safe to call repeatedly/concurrently — claimTask/claimSubtask make task
 * claiming atomic, so overlapping callers can never double-advance the
 * same task. A tick is a no-op if nothing is active.
 *
 * maxDuration: a single tick does at most one real unit of work (e.g. one
 * subtask's web research call), which can take a while. Verify this
 * against your current Vercel plan's actual limit before deploying —
 * documented limits vary by plan and have changed over time.
 */
export const maxDuration = 60;

async function isAuthorized(req: NextRequest, rawBody: string): Promise<boolean> {
  const signature = req.headers.get("upstash-signature");

  if (signature && process.env.QSTASH_CURRENT_SIGNING_KEY) {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
    });

    // MILESTONE 3Z-9 — the length alone (32, unchanged across a full key
    // rotation) wasn't enough to diagnose this. A safe, partial preview
    // — first/last few characters only, never the full secret — lets
    // Innocent directly compare what's actually being read against what
    // he pasted into Upstash, without exposing the real key anywhere.
    const safePreview = (value: string | undefined): string => {
      if (!value) return "(not set)";
      if (value.length <= 10) return `${value.length} chars, too short to preview safely`;
      return `${value.slice(0, 6)}...${value.slice(-4)} (${value.length} chars)`;
    };

    // MILESTONE 3Z-8 — every official Upstash example (TS, Python, Go
    // SDKs) includes a url parameter; our code never did, and
    // verification has been failing consistently rather than
    // intermittently. Worth aligning with documented usage — but
    // defensively: if req.url doesn't exactly match what QStash actually
    // signed against (a real possibility depending on how Vercel
    // forwards the request), a strict url check could turn a previously
    // working path into a strictly-failing one. Try with it; if that
    // specific attempt fails, retry without it before giving up, so this
    // can only help, never regress something that worked before.
    try {
      const valid = await receiver.verify({ signature, body: rawBody, url: req.url });
      if (valid) return true;
    } catch (error) {
      console.error(
        "[api/tasks/tick] QStash verify WITH url threw:",
        error instanceof Error ? error.message : error,
        `| url used: ${req.url}`
      );
    }

    try {
      const validWithoutUrl = await receiver.verify({ signature, body: rawBody });
      if (validWithoutUrl) {
        console.warn(
          "[api/tasks/tick] QStash verify succeeded WITHOUT url but failed WITH it — " +
            `req.url (${req.url}) likely doesn't match what QStash actually signed against.`
        );
        return true;
      }
    } catch (error) {
      console.error(
        "[api/tasks/tick] QStash verify WITHOUT url also threw:",
        error instanceof Error ? error.message : error,
        `| currentSigningKey: ${safePreview(process.env.QSTASH_CURRENT_SIGNING_KEY)}, ` +
          `nextSigningKey: ${safePreview(process.env.QSTASH_NEXT_SIGNING_KEY)}, ` +
          `incoming signature header: ${safePreview(signature)}`
      );
    }
    // Fall through to the session-cookie check rather than failing
    // outright — a malformed/expired QStash signature shouldn't also
    // block a legitimate browser-originated request.
  }

  const password = process.env.APP_PASSWORD;
  if (!password) return true;

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return false;

  return verifySessionCookieValue(cookie, password);
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!(await isAuthorized(req, rawBody))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await tick();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tasks/tick] failed:", error);
    return NextResponse.json({ error: "Tick failed." }, { status: 500 });
  }
}
