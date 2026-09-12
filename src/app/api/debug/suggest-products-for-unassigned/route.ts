import { NextRequest } from "next/server";
import { noCacheJson } from "@/lib/noCacheJson";
import { getDb } from "@/lib/db";
import { markProspectNeedsProductDecision } from "@/lib/models/prospects";
import { listProductsWithUrl } from "@/lib/models/products";
import { LOCAL_USER_ID } from "@/lib/localUser";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4.1-mini";

/**
 * MILESTONE 5K — turns "44 prospects need a human decision, go research
 * each one" into "confirm what the AI already suggests". Reuses the
 * existing needs_product_decision + candidate_product_names
 * infrastructure (already built, already tested, already has a UI) —
 * this just populates it for prospects that reached needs_human_reply
 * via the productless-prospects cleanup rather than the "not a fit"
 * check that infrastructure was originally built for.
 *
 * GET first to preview which prospects are eligible. POST to actually
 * run the AI review and populate suggestions for the UI to show.
 */
async function findUnassignedNeedingSuggestion() {
  const db = await getDb();
  const result = await db.execute({
    sql: `
      SELECT id, name, organization, fit_reason, evidence
      FROM prospects
      WHERE user_id = ?
        AND sequence_status = 'needs_human_reply'
        AND product_id IS NULL
        AND needs_product_decision = false
      LIMIT 50
    `,
    args: [LOCAL_USER_ID],
  });
  return result.rows as unknown as Array<{
    id: string;
    name: string;
    organization: string | null;
    fit_reason: string | null;
    evidence: string | null;
  }>;
}

export async function GET(_req: NextRequest) {
  const candidates = await findUnassignedNeedingSuggestion();
  return noCacheJson({
    dryRun: true,
    eligibleCount: candidates.length,
    prospects: candidates.map((p) => ({ id: p.id, name: p.name })),
    note: "This is a preview only — nothing changed. POST to this same URL to run the AI review.",
  });
}

export async function POST(_req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return noCacheJson({ error: "OPENAI_API_KEY is not set." }, { status: 500 });
  }

  const candidates = await findUnassignedNeedingSuggestion();
  const products = await listProductsWithUrl();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const results: Array<{ name: string; suggested: string[] | "none" }> = [];

  for (const prospect of candidates) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `
You are matching a prospect (who currently has no product assigned) to
the most likely fit(s) in this portfolio, based only on their existing
evidence. Be honest and conservative — if nothing genuinely fits, say
so rather than forcing a guess. List up to 3 plausible candidates,
ranked most-likely first.

Respond with ONLY a JSON object: {"candidates": string[]} — exact
product names from the list, or an empty array if nothing plausibly
fits.
`,
        },
        {
          role: "user",
          content: `
PROSPECT: ${prospect.name}${prospect.organization ? ` (${prospect.organization})` : ""}
EVIDENCE/FIT REASON: ${prospect.fit_reason ?? "(none recorded)"}
RAW EVIDENCE: ${prospect.evidence ?? "(none)"}

PORTFOLIO:
${products.map((p) => `- ${p.name}: ${p.description ?? p.category}`).join("\n")}
`,
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    let candidateNames: string[] = [];
    try {
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
      candidateNames = Array.isArray(parsed.candidates)
        ? parsed.candidates.filter(
            (name: unknown): name is string =>
              typeof name === "string" &&
              products.some((p) => p.name.toLowerCase() === name.toLowerCase())
          )
        : [];
    } catch {
      candidateNames = [];
    }

    if (candidateNames.length > 0) {
      await markProspectNeedsProductDecision(LOCAL_USER_ID, prospect.id, candidateNames);
      results.push({ name: prospect.name, suggested: candidateNames });
    } else {
      results.push({ name: prospect.name, suggested: "none" });
    }
  }

  return noCacheJson({
    reviewedCount: results.length,
    withSuggestions: results.filter((r) => r.suggested !== "none").length,
    noPlausibleFit: results.filter((r) => r.suggested === "none").length,
    results,
    note: "Prospects with suggestions now show the decision UI on the Prospects page — pick one or delete. Those with no plausible fit were left as needs_human_reply for you to review manually.",
  });
}
