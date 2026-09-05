import { NextRequest, NextResponse } from "next/server";
import {
  getSettings,
  updateSettings,
  getInfraStatus,
} from "@/lib/models/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [settings, infra] = await Promise.all([
      getSettings(),
      Promise.resolve(getInfraStatus()),
    ]);

    return NextResponse.json({ settings, infra });
  } catch (error) {
    console.error("[api/settings] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load settings." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = await updateSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[api/settings] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update settings.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
