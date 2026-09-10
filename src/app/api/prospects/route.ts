import { NextRequest, NextResponse } from "next/server";
import { listProspects } from "@/lib/models/prospects";
import { listProducts } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type {
  ProspectQualificationStatus,
  ProspectType,
} from "@/lib/models/prospects";

import { createProspect } from "@/lib/models/prospects";
import { noCacheJson } from "@/lib/noCacheJson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const qualificationStatus = searchParams.get(
      "qualification_status"
    ) as ProspectQualificationStatus | null;
    const prospectType = searchParams.get(
      "prospect_type"
    ) as ProspectType | null;
    const productId = searchParams.get("product_id");
    const limitParam = searchParams.get("limit");

    const [prospects, products] = await Promise.all([
      listProspects(LOCAL_USER_ID, {
        qualification_status: qualificationStatus ?? undefined,
        prospect_type: prospectType ?? undefined,
        product_id: productId ?? undefined,
        limit: limitParam ? Number(limitParam) : undefined,
      }),
      listProducts(),
    ]);

    const productNameById = new Map(
      products.map((p) => [p.id, p.name])
    );

    const withProductName = prospects.map((prospect) => ({
      ...prospect,
      product_name: prospect.product_id
        ? productNameById.get(prospect.product_id) ?? null
        : null,
    }));

    return noCacheJson({ prospects: withProductName });
  } catch (error) {
    console.error("[api/prospects] GET failed:", error);
    return noCacheJson({ error: "Could not load prospects." }, { status: 500 });
  }
}

/**
 * MILESTONE 4H — manual prospect creation, previously only possible via
 * CSV import. A prospect added this way skips the AI-driven discovery
 * evidence/fit_reason that createProspect() otherwise requires — those
 * fields exist to explain *why* the AI surfaced someone, which doesn't
 * apply when Innocent is adding someone himself. A synthesized entry
 * covers the underlying schema's requirement without pretending this
 * was AI-discovered.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "A name is required." }, { status: 400 });
    }
    if (!body?.email || typeof body.email !== "string") {
      return NextResponse.json({ error: "An email is required." }, { status: 400 });
    }

    const prospect = await createProspect({
      user_id: LOCAL_USER_ID,
      name: body.name,
      email: body.email,
      organization: body.organization || undefined,
      role: body.role || undefined,
      website: body.website || undefined,
      country: body.country || undefined,
      product_id: body.product_id || undefined,
      prospect_type: body.organization ? "organization" : "person",
      qualification_status: "needs_review",
      fit_reason: body.notes || "Manually added by Innocent.",
      opportunity_signal: body.notes || "Manually added — not from an AI-discovered signal.",
      evidence: [
        {
          observation: body.notes || "Manually added directly — not AI-discovered.",
          source: "https://innocent-labs.vercel.app/prospects",
        },
      ],
    });

    return NextResponse.json({ prospect });
  } catch (error) {
    console.error("[api/prospects] POST failed:", error);
    const message = error instanceof Error ? error.message : "Could not add prospect.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
