/**
 * MILESTONE 4T — full autonomy mode: product study.
 *
 * This exists because of a direct request: the agent should be
 * "studying my products to understand them thoroughly, asking questions
 * or clarifications where there are gaps in knowledge, and suggesting
 * improvements" — not just running the same fixed set of automated
 * tasks indefinitely without ever examining whether it actually
 * understands what it's selling.
 *
 * Reviews ONE product's stored knowledge per run (rotating across the
 * portfolio via the scheduler, same pattern as prospecting). Produces
 * at most a few genuinely useful questions and suggestions — this is
 * deliberately conservative; a flood of low-value questions defeats the
 * purpose as surely as asking none at all.
 */

import type { AgentTask } from "@/lib/types";
import type { StepResult, TaskExecutor } from "../types";

import OpenAI from "openai";
import { listProducts, getProductById } from "@/lib/models/products";
import { createQuestion, createSuggestion } from "@/lib/models/agentQuestions";
import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";

const MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `
You are reviewing how well this product's stored knowledge base actually
supports prospecting, outreach, and answering prospect questions about
it. This is a genuine self-assessment, not a formality — be honest about
real gaps and real opportunities, and equally honest when there's
nothing meaningfully wrong.

Two distinct outputs:

QUESTIONS — something a person needs to actually answer for the agent to
do its job well. Only raise a question if the missing information would
genuinely change how prospecting, outreach, or qualification is done.
Do NOT ask questions answerable by re-reading what's already provided,
or generic questions that apply to any product ("who is your target
audience" when audience is already filled in and specific).

SUGGESTIONS — a genuine improvement opportunity that doesn't require an
answer to proceed, e.g. positioning that could be sharper, a gap in the
feature list, pricing information that would help qualify prospects
faster. Not a question — actionable on its own.

Most reviews should produce 0-2 questions and 0-2 suggestions. Producing
nothing is a normal, expected, GOOD outcome when the knowledge is
already solid — do not manufacture busywork.

Respond with ONLY a JSON object:
{"questions": string[], "suggestions": string[]}
`;

async function studyProduct(productId: string): Promise<StepResult> {
  const product = await getProductById(productId);
  if (!product) {
    return { success: false, summary: "Product not found.", errorMessage: "Product not found." };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      success: false,
      summary: "OPENAI_API_KEY not configured — cannot run product study.",
      transientFailure: true,
    };
  }

  const knowledgeSummary = `
PRODUCT: ${product.name} (${product.category})
DESCRIPTION: ${product.description ?? "(none)"}
PROBLEM IT SOLVES: ${product.problem ?? "(none)"}
AUDIENCE: ${product.audience ?? "(none)"}
POSITIONING: ${product.positioning ?? "(none)"}
FEATURES: ${product.features ?? "(none)"}
COMMERCIAL MODEL: ${product.commercial_model ?? "(none)"}
PRICING: ${product.pricing ?? "(none)"}
CALL TO ACTION: ${product.cta ?? "(none)"}
KNOWN UNKNOWNS: ${product.unknowns ?? "(none)"}
SUPPLEMENTARY KNOWLEDGE: ${product.supplementary_knowledge ?? "(none)"}
`.trim();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: knowledgeSummary },
    ],
    temperature: 0.3,
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

  let parsed: { questions?: string[]; suggestions?: string[] };
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  } catch {
    return { success: false, summary: "Could not parse product study response.", transientFailure: true };
  }

  const questions = (parsed.questions ?? []).slice(0, 3);
  const suggestions = (parsed.suggestions ?? []).slice(0, 3);

  for (const q of questions) {
    await createQuestion(LOCAL_USER_ID, productId, q);
  }
  for (const s of suggestions) {
    await createSuggestion(LOCAL_USER_ID, productId, s);
  }

  return {
    success: true,
    summary:
      questions.length === 0 && suggestions.length === 0
        ? `Reviewed ${product.name}'s knowledge base — no gaps or improvements found.`
        : `Reviewed ${product.name}'s knowledge base — raised ${questions.length} question(s) and ${suggestions.length} suggestion(s).`,
    resultData: { questions, suggestions },
  };
}

/**
 * Picks the product least recently studied — same "rotate toward
 * whatever's most neglected" idea as prospecting's product selection.
 */
async function pickProductToStudy(): Promise<string | null> {
  const products = await listProducts();
  const approved = products.filter((p) => p.approval_status === "approved");
  if (approved.length === 0) return null;

  const sorted = [...approved].sort((a, b) => {
    const aTime = new Date(a.updated_at).getTime();
    const bTime = new Date(b.updated_at).getTime();
    return aTime - bTime;
  });

  return sorted[0].id;
}

export const productStudyExecutor: TaskExecutor = {
  taskType: "product_study",

  async runTask(task: AgentTask): Promise<StepResult> {
    const productId =
      (task.description?.match(/product_id:([a-f0-9-]+)/)?.[1]) ??
      (await pickProductToStudy());

    if (!productId) {
      return { success: true, summary: "No approved products to study." };
    }

    return studyProduct(productId);
  },
};
