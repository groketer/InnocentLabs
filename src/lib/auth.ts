/**
 * MILESTONE 3G — Access gating.
 *
 * A single shared password (APP_PASSWORD) gates the human-facing browser
 * UI and API routes. This is deliberately NOT a multi-user auth system —
 * this has only ever been a single-owner tool (see LOCAL_USER_ID) — just a
 * lock on the front door.
 *
 * Explicitly NOT gated (see middleware.ts's matcher):
 * - /api/cron/* — authenticates separately via CRON_SECRET; Vercel Cron
 *   has no browser session or password to send.
 * - /unsubscribe/[token] — prospects clicking this from their inbox are
 *   never logged into the app at all.
 * - /login, /api/auth/* — would otherwise be a chicken-and-egg lockout.
 *
 * Uses Web Crypto (crypto.subtle) rather than Node's `crypto` module or
 * `Buffer`, so this works whether middleware ends up running on the Edge
 * or Node.js runtime.
 */

export const SESSION_COOKIE_NAME = "ii_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionCookieValue(
  secret: string
): Promise<string> {
  const expiry = Date.now() + SESSION_DURATION_MS;
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(expiry))
  );
  return `${expiry}.${hex(signature)}`;
}

export async function verifySessionCookieValue(
  value: string,
  secret: string
): Promise<boolean> {
  const [expiryStr, signatureHex] = value.split(".");
  if (!expiryStr || !signatureHex) return false;

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const key = await hmacKey(secret);
  const expectedSignature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(expiryStr)
  );

  return hex(expectedSignature) === signatureHex;
}
