import { NextResponse } from "next/server";
import { approveProduct } from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const product = await approveProduct(params.id);
    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/products/[id]/approve] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not approve product.";
    const status = message === "Product not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
