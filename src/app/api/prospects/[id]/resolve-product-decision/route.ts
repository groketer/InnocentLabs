import { NextRequest, NextResponse } from "next/server";
import { resolveProductDecision, getProspectById } from "@/lib/models/prospects";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 4R — resolves a prospect flagged needs_product_decision:
 * reassigns to whichever product Innocent picks, or deletes outright.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    if (body?.action === "delete") {
      const prospect = await getProspectById(LOCAL_USER_ID, params.id);
      await resolveProductDecision(LOCAL_USER_ID, params.id, { action: "delete" });
      return NextResponse.json({ resolved: "deleted", name: prospect?.name ?? null });
    }

    if (body?.action === "reassign" && typeof body.productId === "string") {
      await resolveProductDecision(LOCAL_USER_ID, params.id, {
        action: "reassign",
        productId: body.productId,
      });
      const prospect = await getProspectById(LOCAL_USER_ID, params.id);
      return NextResponse.json({ resolved: "reassigned", prospect });
    }

    return NextResponse.json(
      { error: "action must be \"delete\" or \"reassign\" (with a productId)." },
      { status: 400 }
    );
  } catch (error) {
    console.error("[api/prospects/[id]/resolve-product-decision] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not resolve decision.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
