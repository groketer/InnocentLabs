import { NextRequest, NextResponse } from "next/server";
import { listActiveSequences } from "@/lib/models/prospects";
import { listProducts } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get("id");

  const sequences = await listActiveSequences(LOCAL_USER_ID);
  const products = await listProducts();

  const foundInSequences = sequences.find((s) => s.id === targetId);
  const foundProduct = foundInSequences?.product_id
    ? products.find((p) => p.id === foundInSequences.product_id)
    : null;

  return NextResponse.json({
    totalSequencesReturned: sequences.length,
    foundInSequences: foundInSequences ?? null,
    productLookupResult: foundInSequences?.product_id
      ? { product_id: foundInSequences.product_id, found: !!foundProduct, productName: foundProduct?.name ?? null }
      : "prospect has no product_id",
    allSequenceIds: sequences.map((s) => ({ id: s.id, name: s.name, sequence_status: s.sequence_status })),
  });
}
