import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 6W — the actual delete half of "download and then delete"
 * for the needs_product orphans. Deliberately kept as its own separate
 * endpoint from export-orphaned-prospects — the download should happen
 * and be confirmed first, this should only ever be triggered on
 * purpose afterward.
 *
 * email_sends and inbound_emails both reference prospects.id with no
 * cascade — unlike deleteProduct()'s handling of prospects (preserved,
 * not deleted, since a prospect is a real person with real history),
 * here the prospect itself is being deliberately removed, so its own
 * send/reply history is deleted alongside it rather than orphaned a
 * second time.
 */
async function countOrphans() {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT COUNT(*) as c FROM prospects WHERE user_id = ? AND sequence_status = 'needs_product'`,
    args: [LOCAL_USER_ID],
  });
  return Number((result.rows[0] as unknown as { c: number }).c);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("confirm") === "yes") {
    return applyDelete();
  }

  const count = await countOrphans();
  return noCacheJson({
    dryRun: true,
    orphanedProspectCount: count,
    note: "Preview only — nothing deleted. Download them first via /api/debug/export-orphaned-prospects, then add &confirm=yes to this same URL to permanently delete all of them, including their email send and reply history.",
  });
}

export async function POST(_req: NextRequest) {
  return applyDelete();
}

async function applyDelete() {
  const db = await getDb();

  const idsResult = await db.execute({
    sql: `SELECT id FROM prospects WHERE user_id = ? AND sequence_status = 'needs_product'`,
    args: [LOCAL_USER_ID],
  });
  const ids = (idsResult.rows as unknown as Array<{ id: string }>).map((r) => r.id);

  if (ids.length === 0) {
    return noCacheJson({ deletedCount: 0 });
  }

  // Postgres doesn't take an array directly through this app's simple
  // positional-args execute() — build the IN clause explicitly instead.
  const placeholders = ids.map((_, i) => `@id${i}`).join(", ");
  const args: Record<string, string> = { user_id: LOCAL_USER_ID };
  ids.forEach((id, i) => {
    args[`id${i}`] = id;
  });

  await db.execute({
    sql: `DELETE FROM email_sends WHERE prospect_id IN (${placeholders})`,
    args,
  });

  await db.execute({
    sql: `DELETE FROM inbound_emails WHERE prospect_id IN (${placeholders})`,
    args,
  });

  const result = await db.execute({
    sql: `DELETE FROM prospects WHERE user_id = @user_id AND sequence_status = 'needs_product' AND id IN (${placeholders})`,
    args,
  });

  return noCacheJson({ deletedCount: result.rowsAffected });
}
