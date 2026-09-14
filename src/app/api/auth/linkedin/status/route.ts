import { NextResponse } from "next/server";
import { getLinkedInConnectionStatus } from "@/lib/models/linkedinConnection";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getLinkedInConnectionStatus(LOCAL_USER_ID);
    return NextResponse.json(status);
  } catch (error) {
    console.error("[api/auth/linkedin/status] GET failed:", error);
    return NextResponse.json({ error: "Could not check LinkedIn connection status." }, { status: 500 });
  }
}
