import { NextRequest, NextResponse } from "next/server";
import { listProspects } from "@/lib/models/prospects";
import { listProducts } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";
import type {
  ProspectQualificationStatus,
  ProspectType,
} from "@/lib/models/prospects";

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

    return NextResponse.json({ prospects: withProductName });
  } catch (error) {
    console.error("[api/prospects] GET failed:", error);
    return NextResponse.json(
      { error: "Could not load prospects." },
      { status: 500 }
    );
  }
}
