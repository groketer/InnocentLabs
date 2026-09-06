import { NextResponse } from "next/server";
import { listAllProspectsForExport } from "@/lib/models/prospects";
import { listProducts } from "@/lib/models/products";
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
  "product_name",
  "qualification_status",
  "sequence_status",
  "emails_sent",
  "confidence",
  "fit_reason",
  "opportunity_signal",
  "source_url",
  "website",
  "created_at",
];

export async function GET() {
  try {
    const [prospects, products] = await Promise.all([
      listAllProspectsForExport(LOCAL_USER_ID),
      listProducts(),
    ]);

    const productNameById = new Map(products.map((p) => [p.id, p.name]));

    const rows = prospects.map((p) => [
      p.id,
      p.name,
      p.organization ?? "",
      p.role ?? "",
      p.email ?? "",
      p.prospect_type,
      p.product_id ? productNameById.get(p.product_id) ?? "" : "",
      p.qualification_status,
      p.sequence_status,
      p.emails_sent,
      p.confidence ?? "",
      p.fit_reason ?? "",
      p.opportunity_signal ?? "",
      p.evidence?.[0]?.source ?? "",
      p.website ?? "",
      p.created_at,
    ]);

    const csv = buildCsv(HEADERS, rows);
    const filename = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[api/prospects/export] GET failed:", error);
    return NextResponse.json({ error: "Could not export prospects." }, { status: 500 });
  }
}
