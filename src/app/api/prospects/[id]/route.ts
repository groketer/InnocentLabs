import { NextRequest, NextResponse } from "next/server";
import { updateProspect } from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    if (!body?.qualification_status) {
      return NextResponse.json(
        { error: "qualification_status is required." },
        { status: 400 }
      );
    }

    const prospect = await updateProspect(LOCAL_USER_ID, params.id, {
      qualification_status: body.qualification_status,
    });

    return NextResponse.json({ prospect });
  } catch (error) {
    console.error("[api/prospects/[id]] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update prospect.";
    const status = message === "Prospect not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
