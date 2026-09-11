import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4U — a direct, evidence-first diagnosis of the persistent
 * QStash 401. Keys and destination URL are both confirmed correct
 * (checked directly against Upstash's console), so this checks the
 * remaining candidate per Upstash's own docs: a raw-body/hash mismatch,
 * or a sub (url) claim mismatch, would each independently cause
 * exactly this failure even with perfectly correct keys.
 *
 * Decodes the JWT's claims directly (base64url, no signature check
 * needed for this) and separately computes what THIS route sees as
 * the raw body/url, so any mismatch is visible directly rather than
 * inferred from a generic "signature verification failed".
 *
 * Point a real QStash test message at this URL (Upstash Console →
 * Requests → Publish, or a temporary schedule) to capture a genuine
 * request — a curl test won't have a real signature to decode.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("upstash-signature");

  const result: Record<string, unknown> = {
    serverTimestamp: new Date().toISOString(),
    reqUrl: req.url,
    rawBodyLength: rawBody.length,
    rawBodyPreview: rawBody.slice(0, 200),
    hasSignatureHeader: !!signature,
  };

  if (!signature) {
    return NextResponse.json({
      ...result,
      note: "No upstash-signature header present on this request at all.",
    });
  }

  // Decode the JWT's claims directly, without verifying — this works
  // regardless of whether the signature is valid, so it tells us what
  // QStash actually claims even if verification fails.
  try {
    const parts = signature.split(".");
    if (parts.length !== 3) {
      result.jwtDecodeError = `Expected 3 dot-separated parts, got ${parts.length}`;
    } else {
      const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
      const claims = JSON.parse(payloadJson);
      result.jwtClaims = claims;

      // Per Upstash's docs: body claim = base64url(sha256(rawBody))
      const computedHash = crypto
        .createHash("sha256")
        .update(rawBody)
        .digest("base64url");

      result.computedBodyHashFromThisRequest = computedHash;
      result.claimedBodyHashInJWT = claims.body;
      result.bodyHashesMatch = computedHash === claims.body;

      result.claimedUrlInJWT = claims.sub;
      result.actualReqUrl = req.url;
      result.urlsMatch = claims.sub === req.url;

      const nowSeconds = Math.floor(Date.now() / 1000);
      result.tokenExpired = typeof claims.exp === "number" ? nowSeconds > claims.exp : "unknown";
      result.tokenNotYetValid = typeof claims.nbf === "number" ? nowSeconds < claims.nbf : "unknown";
      result.serverClockUnixSeconds = nowSeconds;
    }
  } catch (error) {
    result.jwtDecodeError = error instanceof Error ? error.message : String(error);
  }

  // Also run the real SDK verification for direct comparison.
  if (process.env.QSTASH_CURRENT_SIGNING_KEY) {
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY.trim(),
      nextSigningKey: (process.env.QSTASH_NEXT_SIGNING_KEY ?? "").trim(),
    });
    try {
      const valid = await receiver.verify({ signature, body: rawBody, url: req.url });
      result.sdkVerifyWithUrl = valid;
    } catch (error) {
      result.sdkVerifyWithUrlError = error instanceof Error ? error.message : String(error);
    }
    try {
      const valid = await receiver.verify({ signature, body: rawBody });
      result.sdkVerifyWithoutUrl = valid;
    } catch (error) {
      result.sdkVerifyWithoutUrlError = error instanceof Error ? error.message : String(error);
    }
  } else {
    result.sdkVerifyNote = "QSTASH_CURRENT_SIGNING_KEY not set in this environment.";
  }

  console.log("[qstash-diagnose] Full result:", JSON.stringify(result, null, 2));

  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    note: "This endpoint needs a real QStash-signed POST to diagnose anything. Use Upstash Console → Requests → Publish (or a temporary schedule) pointed at this URL.",
  });
}
