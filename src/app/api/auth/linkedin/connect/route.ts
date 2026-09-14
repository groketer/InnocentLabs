import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6S — step 1 of the LinkedIn OAuth flow. Requires
 * LINKEDIN_CLIENT_ID (a static, per-app credential from the LinkedIn
 * Developer app — distinct from the per-connection access token this
 * flow produces) to already be set as an environment variable.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "LINKEDIN_CLIENT_ID is not set. Create a LinkedIn Developer app first, then set this environment variable." },
      { status: 400 }
    );
  }

  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/linkedin/callback`;
  const state = randomUUID();

  const authorizeUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", "openid profile w_member_social");

  const response = NextResponse.redirect(authorizeUrl.toString());
  // Short-lived, HTTP-only cookie carrying the state for CSRF
  // verification on the callback — not a session, just a one-time
  // round-trip check for this single connect action.
  response.cookies.set("linkedin_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
