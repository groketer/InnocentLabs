import { NextResponse } from "next/server";
import { getInsightsByProduct } from "@/lib/models/insights";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const insights = await getInsightsByProduct(LOCAL_USER_ID);
    return NextResponse.json({ insights });
  } catch (error) {
    console.error("[api/insights] GET failed:", error);
    return NextResponse.json({ error: "Could not load insights." }, { status: 500 });
  }
}
