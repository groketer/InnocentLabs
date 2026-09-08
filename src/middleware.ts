import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;

  // No password configured: don't gate anything. This preserves current
  // behavior for anyone who hasn't set APP_PASSWORD yet, rather than
  // locking them out before they've had a chance to configure it.
  if (!password) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = cookie
    ? await verifySessionCookieValue(cookie, password)
    : false;

  if (authenticated) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("redirect", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // MILESTONE 3Z-10 — added api/tick-status and api/debug to the
    // exclusion list. Both are read-only (or self-contained) diagnostic
    // endpoints exposing no sensitive data — just timestamps and status
    // text — and testing them meaningfully requires visiting them
    // directly, independent of whatever browser session state happens
    // to exist at the time. Requiring login defeated that purpose.
    "/((?!api/cron|api/auth|api/tasks/tick|api/tick-status|api/debug|unsubscribe|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
