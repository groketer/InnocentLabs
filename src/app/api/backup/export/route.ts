import { NextResponse } from "next/server";
import { listAllProspectsForExport } from "@/lib/models/prospects";
import { listAllSendsForExport } from "@/lib/models/emailSends";
import { listAllInboundForExport } from "@/lib/models/inboundEmails";
import { listProducts } from "@/lib/models/products";
import { getSettings } from "@/lib/models/settings";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 3N — genuine backup, not just a spreadsheet export.
 *
 * Everything a restore would need: prospects, the full correspondence
 * history, products, and settings, as one structured JSON file. The CSV
 * exports (prospects/followups/products) are for reviewing data in a
 * spreadsheet; this is for "something went wrong, get me back to where I
 * was" — kept separate on purpose rather than trying to make one format
 * serve both jobs well.
 */
export async function GET() {
  try {
    const [prospects, sends, inbound, products, settings] = await Promise.all([
      listAllProspectsForExport(LOCAL_USER_ID),
      listAllSendsForExport(LOCAL_USER_ID),
      listAllInboundForExport(LOCAL_USER_ID),
      listProducts(),
      getSettings(),
    ]);

    const backup = {
      exported_at: new Date().toISOString(),
      version: 1,
      prospects,
      email_sends: sends,
      inbound_emails: inbound,
      products,
      settings,
    };

    const filename = `innocent-intelligence-backup-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[api/backup/export] GET failed:", error);
    return NextResponse.json({ error: "Could not create backup." }, { status: 500 });
  }
}
