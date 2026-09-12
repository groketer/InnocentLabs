import { NextRequest, NextResponse } from "next/server";
import { reassignProspectToProduct, getProspectById } from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 5K — a general-purpose "change this prospect's product"
 * action, available for ANY prospect at any time. The existing
 * reassignment UI only ever appeared when needs_product_decision was
 * true (set specifically by the AI's "not a fit" check) — a prospect
 * stuck at needs_human_reply for an unrelated reason (e.g. the
 * productless-prospects cleanup) had no way to be reassigned from the
 * UI at all. This is the direct fix: a plain, always-available action.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    if (!body?.productId || typeof body.productId !== "string") {
      return NextResponse.json({ error: "A productId is required." }, { status: 400 });
    }

    const prospect = await reassignProspectToProduct(LOCAL_USER_ID, params.id, body.productId);
    const full = await getProspectById(LOCAL_USER_ID, params.id);

    return NextResponse.json({ prospect: full ?? prospect });
  } catch (error) {
    console.error("[api/prospects/[id]/reassign] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not reassign prospect.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
