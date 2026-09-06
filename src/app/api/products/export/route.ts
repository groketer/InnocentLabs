import { NextResponse } from "next/server";
import { listProducts } from "@/lib/models/products";
import { buildCsv } from "@/lib/csv/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "name",
  "category",
  "status",
  "url",
  "description",
  "problem",
  "audience",
  "positioning",
  "pricing",
  "cta",
  "notes",
  "confidence",
  "last_audited_at",
];

export async function GET() {
  try {
    const products = await listProducts();

    const rows = products
      .filter((p) => p.asset_type === "product")
      .map((p) => [
        p.name,
        p.category,
        p.status,
        p.url ?? "",
        p.description ?? "",
        p.problem ?? "",
        p.audience ?? "",
        p.positioning ?? "",
        p.pricing ?? "",
        p.cta ?? "",
        p.notes ?? "",
        p.confidence ?? "",
        p.last_audited_at ?? "",
      ]);

    const csv = buildCsv(HEADERS, rows);
    const filename = `products-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[api/products/export] GET failed:", error);
    return NextResponse.json({ error: "Could not export products." }, { status: 500 });
  }
}
