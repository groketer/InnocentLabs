import { NextResponse } from "next/server";
import { deleteProductDocument } from "@/lib/models/productDocuments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; documentId: string } }
) {
  try {
    await deleteProductDocument(params.documentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/products/[id]/documents/[documentId]] DELETE failed:", error);
    return NextResponse.json({ error: "Could not delete document." }, { status: 500 });
  }
}
