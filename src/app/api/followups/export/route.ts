import { NextResponse } from "next/server";
import { listAllProspectsForExport } from "@/lib/models/prospects";
import { listAllSendsForExport } from "@/lib/models/emailSends";
import { listAllInboundForExport } from "@/lib/models/inboundEmails";
import { buildCsv } from "@/lib/csv/csv";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "date",
  "prospect_name",
  "prospect_email",
  "direction",
  "type",
  "subject",
  "body",
  "status",
];

export async function GET() {
  try {
    const [prospects, sends, inbound] = await Promise.all([
      listAllProspectsForExport(LOCAL_USER_ID),
      listAllSendsForExport(LOCAL_USER_ID),
      listAllInboundForExport(LOCAL_USER_ID),
    ]);

    const prospectById = new Map(prospects.map((p) => [p.id, p]));

    type Row = { date: string; prospectId: string | null; direction: string; type: string; subject: string; body: string; status: string };
    const rows: Row[] = [
      ...sends.map((s): Row => ({
        date: s.sent_at,
        prospectId: s.prospect_id,
        direction: "outbound",
        type: s.direction === "reply" ? "autonomous reply" : "outreach",
        subject: s.subject,
        body: s.body,
        status: s.status,
      })),
      ...inbound.map((i): Row => ({
        date: i.received_at,
        prospectId: i.prospect_id ?? null,
        direction: "inbound",
        type: i.classification,
        subject: i.subject ?? "",
        body: i.body ?? "",
        status: i.handled,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const csvRows = rows.map((r) => {
      const prospect = r.prospectId ? prospectById.get(r.prospectId) : undefined;
      return [
        r.date,
        prospect?.name ?? "(unknown)",
        prospect?.email ?? "",
        r.direction,
        r.type,
        r.subject,
        r.body,
        r.status,
      ];
    });

    const csv = buildCsv(HEADERS, csvRows);
    const filename = `correspondence-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[api/followups/export] GET failed:", error);
    return NextResponse.json({ error: "Could not export correspondence." }, { status: 500 });
  }
}
