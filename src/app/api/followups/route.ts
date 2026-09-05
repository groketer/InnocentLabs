import { NextResponse } from "next/server";
import { listActiveSequences } from "@/lib/models/prospects";
import { listProducts } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [sequences, products] = await Promise.all([
      listActiveSequences(LOCAL_USER_ID),
      listProducts(),
    ]);

    const productNameById = new Map(products.map((p) => [p.id, p.name]));

    const withProductName = sequences.map((prospect) => ({
      ...prospect,
      product_name: prospect.product_id
        ? productNameById.get(prospect.product_id) ?? null
        : null,
    }));

    return NextResponse.json({ sequences: withProductName });
  } catch (error) {
    console.error("[api/followups] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load follow-ups." },
      { status: 500 }
    );
  }
}
