import { NextResponse } from "next/server";

/**
 * MILESTONE 4M — a systemic gap this closes: dynamic = "force-dynamic"
 * stops Next.js's own build-time/ISR caching, but doesn't add an
 * explicit no-cache response header — meaning a browser (or an
 * intermediary CDN) can still cache a GET response for some default
 * duration. This was confirmed as the actual root cause of a real,
 * confusing incident: a prospect's status had genuinely changed in the
 * database, but /api/followups kept serving an identical, stale
 * response — even across what should have been fresh requests — because
 * nothing told the browser not to cache it.
 *
 * Use this for any GET route showing data that changes and needs to be
 * observed as current — which in practice is most of them.
 */
export const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export function noCacheJson<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, {
    status: init?.status,
    headers: NO_CACHE_HEADERS,
  });
}
