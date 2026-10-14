import { NextRequest, NextResponse } from "next/server";
import {
  getSettings,
  updateSettings,
  getInfraStatus,
} from "@/lib/models/settings";
import { clearAiProviderCache } from "@/lib/ai/provider";

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
    // A provider switch should apply right away on this instance rather
    // than after the provider cache expires.
    clearAiProviderCache();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[api/settings] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update settings.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
