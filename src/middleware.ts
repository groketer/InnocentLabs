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
    "/((?!api/cron|api/auth|unsubscribe|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
