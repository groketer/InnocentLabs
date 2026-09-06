import { NextResponse } from "next/server";
import { listProducts, getLatestWebsiteAuditResult } from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await listProducts();

    const withSeo = await Promise.all(
      products.map(async (product) => {
        const audit = await getLatestWebsiteAuditResult(product.name);
        const seo = audit?.result_data?.seo as
          | { issues: string[]; word_count: number }
          | undefined;

        return {
          ...product,
          seo_issues: seo?.issues ?? null,
        };
      })
    );

    return NextResponse.json({ products: withSeo });
  } catch (error) {
    console.error("[api/products] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load products." },
      { status: 500 }
    );
  }
}
