import { NextRequest, NextResponse } from "next/server";
import { upsertLinkedInConnection } from "@/lib/models/linkedinConnection";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const origin = req.nextUrl.origin;
  const redirectBackTo = `${origin}/settings`;

  if (errorParam) {
    return NextResponse.redirect(`${redirectBackTo}?linkedin_error=${encodeURIComponent(errorParam)}`);
  }

  const expectedState = req.cookies.get("linkedin_oauth_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${redirectBackTo}?linkedin_error=state_mismatch`);
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${redirectBackTo}?linkedin_error=missing_credentials`);
  }

  const redirectUri = `${origin}/api/auth/linkedin/callback`;

  try {
    // Step 1: exchange the authorization code for an access token.
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text().catch(() => "");
      console.error("[linkedin/callback] token exchange failed:", body);
      return NextResponse.redirect(`${redirectBackTo}?linkedin_error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken: string | undefined = tokenData.access_token;
    const expiresInSeconds: number | undefined = tokenData.expires_in;

    if (!accessToken) {
      return NextResponse.redirect(`${redirectBackTo}?linkedin_error=no_access_token`);
    }

    // Step 2: fetch the connected profile's own ID, to build the
    // "author" URN every future publish call needs.
    const userInfoResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoResponse.ok) {
      const body = await userInfoResponse.text().catch(() => "");
      console.error("[linkedin/callback] userinfo fetch failed:", body);
      return NextResponse.redirect(`${redirectBackTo}?linkedin_error=userinfo_failed`);
    }

    const userInfo = await userInfoResponse.json();
    const sub: string | undefined = userInfo.sub;

    if (!sub) {
      return NextResponse.redirect(`${redirectBackTo}?linkedin_error=no_profile_id`);
    }

    const personUrn = `urn:li:person:${sub}`;
    const expiresAt = expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
      : null;

    await upsertLinkedInConnection({
      user_id: LOCAL_USER_ID,
      access_token: accessToken,
      person_urn: personUrn,
      expires_at: expiresAt,
    });

    const response = NextResponse.redirect(`${redirectBackTo}?linkedin_connected=1`);
    response.cookies.delete("linkedin_oauth_state");
    return response;
  } catch (error) {
    console.error("[linkedin/callback] unexpected error:", error);
    return NextResponse.redirect(`${redirectBackTo}?linkedin_error=unexpected`);
  }
}
