import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/models/stats";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getDashboardStats(LOCAL_USER_ID);
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[api/stats] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load stats." },
      { status: 500 }
    );
  }
}
