import { NextRequest, NextResponse } from "next/server";
import {
  updateProductNotes,
  updateProductGeographicFocus,
  updateProductCampaignPaused,
  updateProductSupplementaryKnowledge,
  updateProductBrief,
  updateProductRequireIndividualProspects,
  deleteProduct,
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
    const hasRequireIndividuals = typeof body?.require_individual_prospects === "boolean";

    // MILESTONE 6T — a genuine manual override for the brief fields,
    // explicitly requested to never call the AI: a plain PATCH straight
    // to updateProductBrief(), the same function "Generate Brief"
    // itself calls — so a hand-typed brief and an AI-generated one are
    // indistinguishable to prospecting afterward, at zero API cost for
    // the manual path.
    const briefFields = ["problem", "audience", "positioning", "features", "commercial_model", "pricing", "cta"] as const;
    const briefUpdate: Record<string, string> = {};
    for (const key of briefFields) {
      if (typeof body?.[key] === "string") {
        briefUpdate[key] = body[key];
      }
    }
    const hasBrief = Object.keys(briefUpdate).length > 0;

    if (!hasNotes && !hasGeo && !hasPaused && !hasKnowledge && !hasBrief && !hasRequireIndividuals) {
      return NextResponse.json(
        {
          error:
            "notes, geographic_focus, campaign_paused, supplementary_knowledge, require_individual_prospects, or a brief field is required.",
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
    if (hasBrief) {
      product = await updateProductBrief(params.id, briefUpdate);
    }
    if (hasRequireIndividuals) {
      product = await updateProductRequireIndividualProspects(
        params.id,
        body.require_individual_prospects
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


export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await deleteProduct(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/products/[id]] DELETE failed:", error);
    const message = error instanceof Error ? error.message : "Could not delete product.";
    const status = message === "Product not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
