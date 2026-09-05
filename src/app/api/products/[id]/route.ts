import { NextRequest, NextResponse } from "next/server";
import { updateProductNotes } from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    if (typeof body?.notes !== "string") {
      return NextResponse.json(
        { error: "notes (string) is required." },
        { status: 400 }
      );
    }

    const product = await updateProductNotes(params.id, body.notes);
    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/products/[id]] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update product.";
    const status = message === "Product not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
