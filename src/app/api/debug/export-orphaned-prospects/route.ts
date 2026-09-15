import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildCsv } from "@/lib/csv/csv";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "id",
  "name",
  "organization",
  "role",
  "email",
  "prospect_type",
  "qualification_status",
  "emails_sent",
  "confidence",
  "fit_reason",
  "opportunity_signal",
  "website",
  "created_at",
];

/**
 * MILESTONE 6W — a direct request: 405 prospects orphaned by deleted
 * products, judged not a fit for the 4 remaining products, to be
 * downloaded for the owner's own records and then removed. Deliberately
 * a separate endpoint from the delete action below — download first,
 * confirm the file looks right, only then trigger the delete.
 */
export async function GET() {
  try {
    const db = await getDb();
    const result = await db.execute({
      sql: `SELECT * FROM prospects WHERE user_id = ? AND sequence_status = 'needs_product' ORDER BY created_at ASC`,
      args: [LOCAL_USER_ID],
    });

    const rows = (result.rows as unknown as Array<Record<string, unknown>>).map((p) => [
      p.id,
      p.name,
      p.organization ?? "",
      p.role ?? "",
      p.email ?? "",
      p.prospect_type,
      p.qualification_status,
      p.emails_sent ?? 0,
      p.confidence ?? "",
      p.fit_reason ?? "",
      p.opportunity_signal ?? "",
      p.website ?? "",
      p.created_at,
    ]);

    const csv = buildCsv(HEADERS, rows);
    const filename = `orphaned-prospects-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[api/debug/export-orphaned-prospects] GET failed:", error);
    return NextResponse.json({ error: "Could not export orphaned prospects." }, { status: 500 });
  }
}
