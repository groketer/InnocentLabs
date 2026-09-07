/**
 * MILESTONE 3S — genuine deep qualification.
 *
 * This exists because of a real, direct complaint: "I need the agent to
 * always do thorough research before qualifying a prospect." The
 * previous mechanism for autonomous qualification was a single SQL
 * comparison — WHERE confidence >= threshold — checked against a number
 * assigned once, quickly, during the original discovery pass. No fresh
 * research, no second look, no verification that the original
 * assessment still holds up.
 *
 * This replaces that with an actual research agent, run separately for
 * each prospect sitting in needs_review, that:
 *
 * 1. re-examines the existing evidence rather than trusting it blindly;
 * 2. searches for genuinely new signals — recent news, hiring activity,
 *    growth or pain indicators — not just re-reading the same page;
 * 3. explicitly argues AGAINST qualifying before reaching a verdict, a
 *    deliberate self-critique step to avoid rubber-stamping;
 * 4. only then produces a reasoned, evidence-backed decision.
 *
 * A prospect processed here never stays stuck in needs_review — it comes
 * out the other side either qualified or unqualified, with confidence
 * and fit_reason reflecting the FRESH research, not the original guess.
 */

import type { AgentTask } from "@/lib/types";
import type { StepResult, SubtaskPlanItem, TaskExecutor } from "../types";

import { Agent, run, webSearchTool } from "@openai/agents";
import {
  listProspects,
  getProspectById,
  applyDeepQualificationResult,
  type ProspectEvidence,
} from "@/lib/models/prospects";
import { getProductById } from "@/lib/models/products";
import { getSettings } from "@/lib/models/settings";
import { recordApiUsage } from "@/lib/models/apiUsage";

const MODEL = "gpt-4.1-mini";
const MAX_TURNS = 6;
const BATCH_SIZE = 15;

const SYSTEM_PROMPT = `
You are doing a genuine, thorough qualification review of ONE prospect
for ONE Innocent Labs product. This is a deliberate SECOND LOOK, separate
from and more rigorous than whatever assessment first identified this
prospect — the original assessment is a starting point to verify, not a
conclusion to rubber-stamp.

YOUR PROCESS, IN ORDER:

1. Review the existing evidence you're given. Does it actually hold up?
   Is it specific to this prospect, or generic enough to apply to almost
   anyone?

2. Use your web search tool to look for genuinely NEW signals beyond what's
   already recorded — recent news about the prospect, hiring activity,
   apparent growth or expansion, stated pain points, or anything else
   that speaks to real need or capacity for this specific product. Do
   not just re-read the same page that produced the original evidence —
   look for something new.

3. Before deciding, explicitly argue AGAINST qualifying this prospect.
   Write out the strongest honest case that this is NOT a good fit or
   that the evidence is too thin — genuinely try to find the weak points
   in the case for qualifying, not a token objection you dismiss
   immediately.

4. Only after that, reach a final, reasoned verdict.

GROUNDING RULE (same discipline as the rest of this system):
Every claim must trace to something you or the original evidence
actually observed. Never invent a company's size, needs, or
circumstances. If you cannot find enough to be confident either way,
that itself is a valid finding — qualify only when the evidence genuinely
supports it, not by default.

CONFIDENCE:
A number from 0 to 1 reflecting how well-supported this decision is by
real evidence — not how likely they are to buy, not how good a lead
"feels." A well-evidenced "unqualified" can and should carry high
confidence too.

OUTPUT FORMAT:
Respond with ONLY a JSON object, no markdown fences, no commentary:

{
  "qualified": true or false,
  "confidence": 0.0 to 1.0,
  "against_qualifying": "the honest case against, from step 3, one to two sentences",
  "fit_reason": "the final reasoned assessment, one to three sentences, written as if explaining the decision to Innocent",
  "new_evidence": [
    {"observation": "...", "source": "https://..."}
  ]
}

new_evidence should contain only genuinely NEW findings from this review
(step 2) — do not repeat the evidence you were given. It can be an empty
array if nothing new was found; that's a legitimate outcome, not a
failure.
`.trim();

interface DeepQualificationDecision {
  qualified: boolean;
  confidence: number;
  against_qualifying: string;
  fit_reason: string;
  new_evidence: ProspectEvidence[];
}

function buildUserPrompt(input: {
  prospectName: string;
  organization?: string;
  role?: string;
  website?: string;
  existingFitReason?: string;
  existingEvidence: ProspectEvidence[];
  productName: string;
  productDescription?: string;
  productProblem?: string;
  productAudience?: string;
}): string {
  const lines: string[] = [];

  lines.push("PROSPECT UNDER REVIEW:");
  lines.push(`- Name: ${input.prospectName}`);
  if (input.organization) lines.push(`- Organization: ${input.organization}`);
  if (input.role) lines.push(`- Role: ${input.role}`);
  if (input.website) lines.push(`- Website: ${input.website}`);

  lines.push("");
  lines.push("PRODUCT BEING CONSIDERED:");
  lines.push(`- Name: ${input.productName}`);
  if (input.productDescription) lines.push(`- Description: ${input.productDescription}`);
  if (input.productProblem) lines.push(`- Problem it solves: ${input.productProblem}`);
  if (input.productAudience) lines.push(`- Intended audience: ${input.productAudience}`);

  lines.push("");
  lines.push("ORIGINAL ASSESSMENT (verify this, don't just trust it):");
  lines.push(`- Original fit reason: ${input.existingFitReason ?? "none given"}`);
  if (input.existingEvidence.length > 0) {
    lines.push("- Original evidence:");
    for (const e of input.existingEvidence.slice(0, 8)) {
      lines.push(`  - ${e.observation} (source: ${e.source})`);
    }
  } else {
    lines.push("- No prior evidence was recorded.");
  }

  return lines.join("\n");
}

function parseDecision(raw: string): DeepQualificationDecision {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  if (typeof parsed.qualified !== "boolean") {
    throw new Error('Deep qualification output missing boolean "qualified".');
  }
  if (typeof parsed.confidence !== "number") {
    throw new Error('Deep qualification output missing numeric "confidence".');
  }
  if (typeof parsed.fit_reason !== "string" || !parsed.fit_reason.trim()) {
    throw new Error('Deep qualification output missing "fit_reason".');
  }

  const newEvidence = Array.isArray(parsed.new_evidence)
    ? (parsed.new_evidence as Array<Record<string, unknown>>)
        .filter((e) => typeof e.observation === "string" && typeof e.source === "string")
        .map((e) => ({
          observation: e.observation as string,
          source: e.source as string,
          observed_at: new Date().toISOString(),
        }))
    : [];

  return {
    qualified: parsed.qualified,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    against_qualifying:
      typeof parsed.against_qualifying === "string" ? parsed.against_qualifying : "",
    fit_reason: parsed.fit_reason.trim(),
    new_evidence: newEvidence,
  };
}

export const deepQualificationExecutor: TaskExecutor = {
  taskType: "deep_qualification",

  async planSubtasks(task: AgentTask): Promise<SubtaskPlanItem[]> {
    const prospects = await listProspects(task.user_id, {
      qualification_status: "needs_review",
      limit: BATCH_SIZE,
    });

    return prospects.map((p) => ({
      title: `Deep-qualify ${p.name}`,
      description: `ProspectId: ${p.id}`,
    }));
  },

  async runSubtask(parent: AgentTask, subtask: AgentTask): Promise<StepResult> {
    const idMatch = subtask.description?.match(/ProspectId:\s*(\S+)/);
    const prospectId = idMatch?.[1]?.trim();

    if (!prospectId) {
      return {
        success: false,
        summary: "No prospect was specified for this review.",
        errorMessage: "Missing ProspectId in subtask description.",
        transientFailure: false,
      };
    }

    const prospect = await getProspectById(parent.user_id, prospectId);
    if (!prospect) {
      return {
        success: true,
        summary: "Skipped — prospect no longer exists.",
        resultData: { skipped: true, reason: "prospect_not_found" },
      };
    }

    if (prospect.qualification_status !== "needs_review") {
      return {
        success: true,
        summary: `Skipped — already ${prospect.qualification_status}.`,
        resultData: { skipped: true, reason: "already_decided" },
      };
    }

    const product = prospect.product_id
      ? await getProductById(prospect.product_id)
      : null;

    if (!product) {
      return {
        success: true,
        summary: "Skipped — no product associated with this prospect.",
        resultData: { skipped: true, reason: "no_product" },
      };
    }

    const agent = new Agent({
      name: "Deep Qualification Reviewer",
      model: MODEL,
      instructions: SYSTEM_PROMPT,
      tools: [webSearchTool()],
    });

    const prompt = buildUserPrompt({
      prospectName: prospect.name,
      organization: prospect.organization,
      role: prospect.role,
      website: prospect.website,
      existingFitReason: prospect.fit_reason,
      existingEvidence: prospect.evidence,
      productName: product.name,
      productDescription: product.description ?? undefined,
      productProblem: product.problem ?? undefined,
      productAudience: product.audience ?? undefined,
    });

    let decision: DeepQualificationDecision;
    try {
      const result = await run(agent, prompt, { maxTurns: MAX_TURNS });

      await recordApiUsage({
        user_id: parent.user_id,
        source: "deep_qualification",
        model: MODEL,
        input_tokens: result.state.usage.inputTokens,
        output_tokens: result.state.usage.outputTokens,
      });

      const raw = result.finalOutput;
      if (!raw) throw new Error("No output from the reviewer.");
      decision = parseDecision(raw);
    } catch (error) {
      return {
        success: false,
        summary: `Could not complete deep qualification for ${prospect.name}.`,
        errorMessage: error instanceof Error ? error.message : "Unknown error.",
        transientFailure: true,
      };
    }

    const settings = await getSettings();
    const passesThreshold = decision.confidence >= settings.auto_qualify_confidence_threshold;
    const finalStatus: "qualified" | "unqualified" =
      decision.qualified && passesThreshold ? "qualified" : "unqualified";

    await applyDeepQualificationResult(parent.user_id, prospect.id, {
      qualification_status: finalStatus,
      confidence: decision.confidence,
      fit_reason: decision.fit_reason,
      additional_evidence: decision.new_evidence,
    });

    return {
      success: true,
      summary: `${prospect.name}: ${finalStatus} (confidence ${decision.confidence.toFixed(2)}) after fresh research — ${decision.new_evidence.length} new evidence item${decision.new_evidence.length === 1 ? "" : "s"} found.`,
      resultData: {
        prospect_id: prospect.id,
        decision: finalStatus,
        confidence: decision.confidence,
        against_qualifying: decision.against_qualifying,
        fit_reason: decision.fit_reason,
        new_evidence_count: decision.new_evidence.length,
      },
    };
  },
};
