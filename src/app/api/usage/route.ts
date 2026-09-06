import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const usage = await getUsageSummary(LOCAL_USER_ID);
    return NextResponse.json({ usage });
  } catch (error) {
    console.error("[api/usage] GET failed:", error);
    return NextResponse.json({ error: "Could not load usage." }, { status: 500 });
  }
}
