/**
 * Content Draft Executor
 * -----------------------
 *
 * MILESTONE 6R — organic content generation, deliberately approval-gated
 * from day one. Generates a single social post draft, grounded only in
 * a product's stored brief (problem/audience/positioning/features —
 * the same fields the Product Brief feature populates), and saves it
 * to the content_drafts queue as 'pending_approval'. This executor
 * never publishes anything — publishing only ever happens as a
 * separate, explicit action after a human approves a specific draft.
 *
 * Uses a plain chat completion, not an agent with tools — no web
 * search is needed here, since the whole point of the product brief
 * feature was to persist grounding data once so operations like this
 * one don't need to re-research it every time.
 */

import OpenAI from "openai";
import type { AgentTask } from "@/lib/types";
import type { StepResult, SubtaskPlanItem, TaskExecutor } from "../types";

import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";
import { listProductsWithUrl, getProductByName } from "@/lib/models/products";
import { createContentDraft } from "@/lib/models/contentDrafts";

const MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `
You write a single LinkedIn post draft for a product, grounded ONLY in
the product information you are given below. Never invent a feature,
a metric, a customer story, or a claim not explicitly supported by
what's given to you.

STYLE:
- Written in first person, as the founder — direct, specific, no
  generic marketing language ("game-changing", "revolutionary",
  "unlock your potential").
- Lead with a real, specific problem or observation, not a pitch.
- 3-6 short paragraphs, LinkedIn-appropriate length (roughly 100-200
  words) — not a wall of text, not a one-liner.
- End with a genuine, low-pressure way to learn more, not a hard sell.
- No hashtag spam — zero, one, or at most two hashtags, only if they
  genuinely fit.

Respond with ONLY a JSON object, no markdown fences:
{"content": "the full post text", "grounding_note": "one sentence noting which specific facts from the product info this post draws on"}
`;

function buildUserPrompt(product: {
  name: string;
  problem?: string | null;
  audience?: string | null;
  positioning?: string | null;
  features?: string | null;
  cta?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`PRODUCT: ${product.name}`);
  if (product.problem) lines.push(`Problem it solves: ${product.problem}`);
  if (product.audience) lines.push(`Audience: ${product.audience}`);
  if (product.positioning) lines.push(`Positioning: ${product.positioning}`);
  if (product.features) lines.push(`Features: ${product.features}`);
  if (product.cta) lines.push(`Call to action: ${product.cta}`);

  if (!product.problem && !product.audience && !product.positioning) {
    lines.push("");
    lines.push(
      "WARNING: this product has very little stored information. Write a post ONLY if you can do so honestly from what's given above — if there's nothing substantive to draw on, respond with an empty content field instead of inventing details."
    );
  }

  return lines.join("\n");
}

async function extractRequestedProductName(task: AgentTask): Promise<string | null> {
  const title = (task.title ?? "").trim();
  const description = (task.description ?? "").trim();
  if (!title && !description) return null;

  const products = await listProductsWithUrl();

  const matchProductName = (text: string): string | null => {
    const normalizedText = text.toLowerCase();
    const matches = products
      .filter((product) => {
        const productName = product.name.trim().toLowerCase();
        if (!productName) return false;
        const escapedName = productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(^|[^a-z0-9])${escapedName}(?=$|[^a-z0-9])`, "i");
        return pattern.test(normalizedText);
      })
      .sort((a, b) => b.name.length - a.name.length);
    return matches[0]?.name ?? null;
  };

  return matchProductName(title) || matchProductName(description) || null;
}

async function generateDraft(parent: AgentTask): Promise<StepResult> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      success: false,
      summary: "Cannot draft content — OPENAI_API_KEY is not set.",
      errorMessage: "OPENAI_API_KEY is not set.",
      transientFailure: false,
    };
  }

  const productName = await extractRequestedProductName(parent);
  if (!productName) {
    return {
      success: false,
      summary: "No specific product was named for this draft.",
      errorMessage: "Could not determine which product to draft content for.",
      transientFailure: false,
    };
  }

  const product = await getProductByName(productName);
  if (!product) {
    return {
      success: false,
      summary: `${productName} was not found in the portfolio.`,
      errorMessage: "Product not found.",
      transientFailure: false,
    };
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(product) },
    ],
    temperature: 0.6,
    response_format: { type: "json_object" },
  });

  if (completion.usage) {
    await recordApiUsage({
      user_id: parent.user_id,
      source: "content_draft",
      model: MODEL,
      input_tokens: completion.usage.prompt_tokens,
      output_tokens: completion.usage.completion_tokens,
    });
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return {
      success: false,
      summary: `Could not draft a post for ${product.name}.`,
      errorMessage: "Empty response from the model.",
      transientFailure: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      success: false,
      summary: `Could not parse a draft for ${product.name}.`,
      errorMessage: "Non-JSON output from the model.",
      transientFailure: true,
    };
  }

  const obj = parsed as { content?: unknown; grounding_note?: unknown };
  const content = typeof obj.content === "string" ? obj.content.trim() : "";
  const groundingNote = typeof obj.grounding_note === "string" ? obj.grounding_note.trim() : null;

  if (!content) {
    return {
      success: false,
      summary: `${product.name} doesn't have enough stored information to draft an honest post yet — try running "Generate brief" on it first.`,
      errorMessage: "Model declined to draft content due to insufficient grounding.",
      transientFailure: false,
    };
  }

  const draft = await createContentDraft({
    user_id: parent.user_id,
    product_id: product.id,
    platform: "linkedin",
    content,
    source_task_id: parent.id,
    grounding_note: groundingNote,
  });

  return {
    success: true,
    summary: `Drafted a LinkedIn post for ${product.name} — waiting in the queue for approval.`,
    resultData: {
      draft_id: draft.id,
      product_id: product.id,
      product_name: product.name,
    },
  };
}

export const contentDraftExecutor: TaskExecutor = {
  taskType: "content_draft",

  planSubtasks(task: AgentTask): SubtaskPlanItem[] {
    return [
      {
        title: `Draft content`,
        description: task.description ?? undefined,
      },
    ];
  },

  async runSubtask(parent: AgentTask, _subtask: AgentTask): Promise<StepResult> {
    return generateDraft(parent);
  },
};
