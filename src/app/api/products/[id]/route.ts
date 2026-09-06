import { NextRequest, NextResponse } from "next/server";
import { updateProductNotes, updateProductGeographicFocus } from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    if (typeof body?.notes !== "string" && typeof body?.geographic_focus !== "string") {
      return NextResponse.json(
        { error: "notes or geographic_focus (string) is required." },
        { status: 400 }
      );
    }

    let product;
    if (typeof body?.notes === "string") {
      product = await updateProductNotes(params.id, body.notes);
    }
    if (typeof body?.geographic_focus === "string") {
      product = await updateProductGeographicFocus(params.id, body.geographic_focus);
    }

    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/products/[id]] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update product.";
    const status = message === "Product not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
