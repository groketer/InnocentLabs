import { NextResponse } from "next/server";
import { listProducts } from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const products = await listProducts();
    return NextResponse.json({ products });
  } catch (error) {
    console.error("[api/products] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load products." },
      { status: 500 }
    );
  }
}
