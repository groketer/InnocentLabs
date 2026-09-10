import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";

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
    return noCacheJson({ error: "?id=... is required." }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT
        id,
        user_id,
        length(user_id) AS user_id_length,
        encode(user_id::bytea, 'hex') AS user_id_hex,
        user_id = 'local-owner' AS user_id_matches_literal,
        sequence_status,
        sequence_status = 'in_conversation' AS matches_literal,
        length(sequence_status) AS char_length,
        encode(sequence_status::bytea, 'hex') AS hex_encoding,
        sequence_status = ANY(ARRAY['pending_approval','active','completed','responded','unsubscribed','paused','in_conversation','needs_human_reply','bounced']) AS matches_in_clause,
        (user_id = 'local-owner' AND sequence_status IN ('pending_approval','active','completed','responded','unsubscribed','paused','in_conversation','needs_human_reply','bounced')) AS matches_full_where_clause
      FROM prospects
      WHERE id = ?
    `,
    args: [id],
  });

  if (result.rows.length === 0) {
    return noCacheJson({ error: "Prospect not found." }, { status: 404 });
  }

  return noCacheJson({ row: result.rows[0] });
}
