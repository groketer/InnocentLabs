import { NextRequest, NextResponse } from "next/server";
import { listProducts, getLatestWebsiteAuditResult, createManualProduct } from "@/lib/models/products";
import { noCacheJson } from "@/lib/noCacheJson";

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

    return noCacheJson({ products: withSeo });
  } catch (error) {
    console.error("[api/products] GET failed:", error);
    return noCacheJson({ error: "Could not load products." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (typeof body?.name !== "string" || typeof body?.url !== "string") {
      return NextResponse.json(
        { error: "name and url are required." },
        { status: 400 }
      );
    }

    const product = await createManualProduct({
      name: body.name,
      url: body.url,
      category: typeof body.category === "string" ? body.category : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    });

    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/products] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not create product.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

