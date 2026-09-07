import { NextRequest, NextResponse } from "next/server";
import {
  updateProductNotes,
  updateProductGeographicFocus,
  updateProductCampaignPaused,
  updateProductSupplementaryKnowledge,
} from "@/lib/models/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();

    const hasNotes = typeof body?.notes === "string";
    const hasGeo = typeof body?.geographic_focus === "string";
    const hasPaused = typeof body?.campaign_paused === "boolean";
    const hasKnowledge = typeof body?.supplementary_knowledge === "string";

    if (!hasNotes && !hasGeo && !hasPaused && !hasKnowledge) {
      return NextResponse.json(
        {
          error:
            "notes, geographic_focus, campaign_paused, or supplementary_knowledge is required.",
        },
        { status: 400 }
      );
    }

    let product;
    if (hasNotes) {
      product = await updateProductNotes(params.id, body.notes);
    }
    if (hasGeo) {
      product = await updateProductGeographicFocus(params.id, body.geographic_focus);
    }
    if (hasPaused) {
      product = await updateProductCampaignPaused(params.id, body.campaign_paused);
    }
    if (hasKnowledge) {
      product = await updateProductSupplementaryKnowledge(
        params.id,
        body.supplementary_knowledge
      );
    }

    return NextResponse.json({ product });
  } catch (error) {
    console.error("[api/products/[id]] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update product.";
    const status = message === "Product not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
