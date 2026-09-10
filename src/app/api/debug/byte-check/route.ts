import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4L — the definitive check for an invisible-character theory:
 * does sequence_status match the literal string 'in_conversation' at
 * the SQL level, what's its exact length, and what are its raw bytes.
 * A visually-identical value with hidden corruption (whitespace, a
 * look-alike unicode character) would show a length != 16 or an
 * unexpected hex sequence, even though every diagnostic that just
 * displays the value looks completely normal.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "?id=... is required." }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        sequence_status,
        sequence_status = 'in_conversation' AS matches_literal,
        length(sequence_status) AS char_length,
        encode(sequence_status::bytea, 'hex') AS hex_encoding,
        sequence_status = ANY(ARRAY['pending_approval','active','completed','responded','unsubscribed','paused','in_conversation','needs_human_reply','bounced']) AS matches_in_clause
      FROM prospects
      WHERE user_id = ? AND id = ?
    `,
    args: [LOCAL_USER_ID, id],
  });

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  return NextResponse.json({ row: result.rows[0] });
}
