import { NextRequest, NextResponse } from "next/server";
import { normalizeCandidate } from "@/lib/taskEngine/executors/prospecting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MILESTONE 7G — a direct request: "is there a way we can prospect
 * without pulling API?" This runs the real, production
 * normalizeCandidate() function — the exact same validation every real
 * prospecting run goes through — against sample candidate JSON, at
 * zero API cost. Confirm a change to this validation logic actually
 * accepts realistic candidates before deploying it, not after.
 *
 * A ready-made, realistic sample candidate is used when no body is
 * given, so this works as a quick sanity check with no setup.
 */
const SAMPLE_CANDIDATE = {
  name: "Jane Doe",
  prospect_type: "person",
  email: "jane@example.com",
  fit_reason: "Struggles with the exact problem this product solves.",
  opportunity_signal: "Recently posted publicly about needing help with this.",
  evidence: [
    {
      observation: "Posted on LinkedIn about struggling with this exact problem.",
      source: "https://linkedin.com/in/janedoe",
      observed_at: new Date().toISOString(),
    },
  ],
  confidence: 0.8,
  unknowns: [],
  competitor_check: "Does not sell a competing product or service.",
  audience_fit_check: "Genuinely matches the described target audience.",
  is_competitor: false,
  is_audience_fit: true,
};

export async function POST(req: NextRequest) {
  let candidates: Record<string, unknown>[];

  try {
    const body = await req.json();
    candidates = Array.isArray(body?.candidates) ? body.candidates : [body];
  } catch {
    candidates = [SAMPLE_CANDIDATE];
  }

  const results = candidates.map((candidate, i) => {
    const normalized = normalizeCandidate(candidate);
    return {
      index: i,
      name: typeof candidate.name === "string" ? candidate.name : "(unnamed)",
      accepted: normalized !== null,
      normalizedResult: normalized,
    };
  });

  return NextResponse.json({
    note: "Zero API calls made — this runs the real normalizeCandidate() function directly against the input given (or a realistic sample if none was given).",
    acceptedCount: results.filter((r) => r.accepted).length,
    totalCount: results.length,
    results,
  });
}

export async function GET() {
  const normalized = normalizeCandidate(SAMPLE_CANDIDATE);
  return NextResponse.json({
    note: "Zero API calls made. This is the built-in realistic sample candidate. POST your own { \"candidates\": [...] } to test specific cases.",
    accepted: normalized !== null,
    normalizedResult: normalized,
  });
}
