import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  updateProspect,
  deleteProspect,
  reassignProspectToProduct,
  getProspectById,
  markProspectNeedsProductDecision,
} from "@/lib/models/prospects";
import { listProductsWithUrl } from "@/lib/models/products";
import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4.1-mini";

/**
 * MILESTONE 4E — when a prospect is marked "Not a fit", check whether
 * they'd genuinely fit any OTHER approved product before keeping them
 * around. If not, there's no reason to keep a disqualified record
 * cluttering the database forever — delete it. If they would fit
 * something else, reassign them there instead of leaving them
 * incorrectly marked unqualified for a product they were never right
 * for in the first place.
 */
async function checkOtherProductFitAndCleanUp(prospectId: string): Promise<{
  action: "deleted" | "reassigned" | "kept" | "needs_decision";
  reassignedTo?: string;
  candidates?: string[];
}> {
  const prospect = await getProspectById(LOCAL_USER_ID, prospectId);
  if (!prospect) return { action: "kept" };

  const otherProducts = (await listProductsWithUrl()).filter(
    (p) => p.id !== prospect.product_id
  );

  if (otherProducts.length === 0 || !process.env.OPENAI_API_KEY) {
    // No other products to check against, or no way to check — leave
    // the prospect as unqualified rather than guessing.
    return { action: "kept" };
  }

  const evidenceText = (prospect.evidence ?? [])
    .map((e) => `- ${e.observation} (source: ${e.source})`)
    .join("\n");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `
You are checking whether a prospect who was just disqualified for one
product might genuinely fit a DIFFERENT product in the same portfolio.
Be honest and skeptical — only say a confident match exists if there's a
real, evidence-based case, not just because it seems plausible. Most
disqualified prospects fit nothing else either; that's the expected,
normal outcome.

MILESTONE 4R — three possible outcomes, not two. Don't force a decision
you're not actually confident in:
- CONFIDENT MATCH: one product is a genuinely strong, evidence-backed
  fit. Set fits_another_product true, name it in best_fit_product_name.
- CONFIDENT NO FIT: nothing else in the portfolio plausibly fits. Set
  fits_another_product false, leave candidate_products empty.
- GENUINELY UNCERTAIN: there are one or more plausible candidates but
  you're not confident enough to commit to one, or evidence is too thin
  to decide reliably. Set fits_another_product false AND list up to 3
  candidate product names in candidate_products — this defers the call
  to a person instead of guessing.

Respond with ONLY a JSON object: {"fits_another_product": boolean, "best_fit_product_name": string | null, "candidate_products": string[], "reasoning": string}
`,
      },
      {
        role: "user",
        content: `
PROSPECT: ${prospect.name}${prospect.organization ? ` (${prospect.organization})` : ""}
EVIDENCE:
${evidenceText || "(none recorded)"}

WAS DISQUALIFIED FOR: the product they were originally found for.

OTHER PRODUCTS IN THE PORTFOLIO TO CHECK:
${otherProducts.map((p) => `- ${p.name}: ${p.description ?? p.category}`).join("\n")}
`,
      },
    ],
    temperature: 0.2,
  });

  if (completion.usage) {
    await recordApiUsage({
      user_id: LOCAL_USER_ID,
      source: "prospecting",
      model: MODEL,
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens,
    });
  }

  let parsed: {
    fits_another_product?: boolean;
    best_fit_product_name?: string | null;
    candidate_products?: string[];
  };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  } catch {
    return { action: "kept" };
  }

  if (parsed.fits_another_product && parsed.best_fit_product_name) {
    const match = otherProducts.find(
      (p) => p.name.toLowerCase() === parsed.best_fit_product_name?.toLowerCase()
    );
    if (match) {
      await reassignProspectToProduct(LOCAL_USER_ID, prospectId, match.id);
      return { action: "reassigned", reassignedTo: match.name };
    }
  }

  const candidates = (parsed.candidate_products ?? []).filter((name) =>
    otherProducts.some((p) => p.name.toLowerCase() === name.toLowerCase())
  );

  if (candidates.length > 0) {
    await markProspectNeedsProductDecision(LOCAL_USER_ID, prospectId, candidates);
    return { action: "needs_decision", candidates };
  }

  await deleteProspect(LOCAL_USER_ID, prospectId);
  return { action: "deleted" };
}

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

    if (body.qualification_status === "unqualified") {
      try {
        const cleanup = await checkOtherProductFitAndCleanUp(params.id);
        return NextResponse.json({ prospect, cleanup });
      } catch (cleanupError) {
        // The status update itself already succeeded — never fail the
        // whole request just because the cleanup check couldn't run.
        console.error("[api/prospects/[id]] Cleanup check failed:", cleanupError);
        return NextResponse.json({ prospect, cleanup: { action: "kept" } });
      }
    }

    return NextResponse.json({ prospect });
  } catch (error) {
    console.error("[api/prospects/[id]] PATCH failed:", error);
    const message =
      error instanceof Error ? error.message : "Could not update prospect.";
    const status = message === "Prospect not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
