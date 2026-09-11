import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAST_TICK_KEY = "last_tick_at";

/**
 * MILESTONE 4V — isolates the write-then-read cycle for the tick
 * timestamp, separate from everything else tick() does. The route
 * returned 200 with a correctly-matched JWT, meaning recordTickTimestamp()
 * should have run (it's the first thing tick() does) — yet the value
 * read back via /api/tick-status was ~5 hours stale. This either
 * confirms a genuine DB write issue, or (if this direct test succeeds)
 * points at something specific to the code path inside tick() itself
 * rather than the underlying write mechanism.
 */
export async function POST() {
  return runDiagnostic();
}

export async function GET() {
  return runDiagnostic();
}

async function runDiagnostic() {
  const before = new Date().toISOString();
  const db = await getDb();

  try {
    await db.execute({
      sql: `
        INSERT INTO app_meta (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `,
      args: [LAST_TICK_KEY, before],
    });
  } catch (error) {
    return NextResponse.json({
      writeAttempted: before,
      writeSucceeded: false,
      writeError: error instanceof Error ? error.message : String(error),
    });
  }

  // Immediately read it back, in a fresh query.
  const readBack = await db.execute({
    sql: `SELECT value FROM app_meta WHERE key = ?`,
    args: [LAST_TICK_KEY],
  });
  const row = readBack.rows[0] as unknown as { value: string } | undefined;

  return NextResponse.json({
    writeAttempted: before,
    writeSucceeded: true,
    readBackValue: row?.value ?? null,
    readMatchesWrite: row?.value === before,
  });
}
