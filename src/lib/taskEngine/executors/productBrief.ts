/**
 * Product Brief Executor
 * -----------------------
 *
 * MILESTONE 6O — the actual missing piece a direct request surfaced:
 * roughly half the portfolio has no stored problem/audience/positioning
 * data at all, and there was no existing feature that visits a
 * product's site and writes that back to its record. The prospecting
 * executor already tells itself to "go visit the URL" for thin
 * products — but that understanding was thrown away after every single
 * run, re-discovered from scratch, over and over, burning tokens on
 * the same rediscovery repeatedly.
 *
 * This executor does that research ONCE and persists it. Every future
 * prospecting run for this product then reads real, stored data
 * instead of guessing — including, specifically, an explicit ideal
 * prospect profile (individual vs. company, named competitor
 * exclusions) folded into the audience field, directly addressing the
 * request this was built for: prospects must be the actual people with
 * the pain point this product solves, not companies selling something
 * similar.
 *
 * Same design principle as the rest of this codebase: the executor
 * observes, grounded only in what the page actually says. It never
 * invents pricing, features, or audience details not genuinely
 * supported by what was found.
 */

import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";

import type { AgentTask } from "@/lib/types";
import type { StepResult, SubtaskPlanItem, TaskExecutor } from "../types";

import { recordApiUsage } from "@/lib/models/apiUsage";
import { LOCAL_USER_ID } from "@/lib/localUser";
import { extractAndParseJson } from "@/lib/extractAndParseJson";
import {
  listProductsWithUrl,
  getProductByName,
  updateProductBrief,
} from "@/lib/models/products";

const MODEL = "gpt-4.1";

const BriefSchema = z.object({
  found_content: z.boolean(),

  problem: z.string().optional(),
  audience: z.string().optional(),
  positioning: z.string().optional(),
  features: z.string().optional(),
  commercial_model: z.string().optional(),
  pricing: z.string().optional(),
  cta: z.string().optional(),

  ideal_prospect_profile: z.string().optional(),
  competitor_exclusions: z.string().optional(),

  unknowns: z.array(z.string()).optional(),
});

function buildInstructions(): string {
  return `
You are researching ONE product, using your web search tool to actually
visit its real website and read what it genuinely says.

Your job is to produce a grounded business brief — never invent or guess
at anything the page does not actually support. If the site says
nothing meaningful about a field, leave it out or note it as unknown.

Fields to determine, ONLY from what you actually observe:

- problem: the specific problem this product solves, in concrete terms.
- audience: who this is actually for. Be specific — an individual
  experiencing a specific problem, or a genuine institutional/B2B buyer?
  Do not default to "businesses and professionals" as a vague catch-all.
- positioning: how the product presents itself relative to alternatives.
- features: the real, stated capabilities — not a marketing tagline.
- commercial_model: how it's sold (subscription, one-time, service, etc.) if stated.
- pricing: actual pricing if genuinely stated on the page.
- cta: what the page asks a visitor to actually do.

Two fields that matter most for this specific brief:

- ideal_prospect_profile: describe, specifically, the kind of individual
  or organization who would be a genuine prospect — someone who
  actually has the problem this product solves and would plausibly buy
  it. Be concrete: "individual founders running a small business who
  struggle with X", not "anyone interested in Y".

- competitor_exclusions: explicitly name the KIND of company or person
  who should NEVER be treated as a prospect for this product — namely,
  anyone who sells a product/service doing roughly the same job, to
  roughly the same buyer. Be concrete and specific to what this product
  actually does (e.g. for an email drip tool: "other email
  marketing/drip-campaign/marketing-automation software companies").

If the page could not be reached or had no meaningful content, set
found_content to false and leave the other fields empty — do not
fabricate a brief for a page you could not actually read.

Respond with ONLY a JSON object matching this shape:
{
  "found_content": boolean,
  "problem": string,
  "audience": string,
  "positioning": string,
  "features": string,
  "commercial_model": string,
  "pricing": string,
  "cta": string,
  "ideal_prospect_profile": string,
  "competitor_exclusions": string,
  "unknowns": string[]
}
`;
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

async function generateBrief(parent: AgentTask): Promise<StepResult> {
  const productName = await extractRequestedProductName(parent);

  if (!productName) {
    return {
      success: false,
      summary: "No specific product was named for this brief.",
      errorMessage: "Could not determine which product to research.",
      transientFailure: false,
    };
  }

  const product = await getProductByName(productName);

  if (!product || !product.url) {
    return {
      success: false,
      summary: `${productName} was not found in the portfolio, or has no URL to research.`,
      errorMessage: "Product not found or missing URL.",
      transientFailure: false,
    };
  }

  const briefAgent = new Agent({
    name: "Innocent Intelligence Product Brief Agent",
    model: MODEL,
    instructions: buildInstructions(),
    // Do NOT specify outputType here — combining structured output
    // enforcement with a live web search tool has previously caused the
    // SDK to reject valid responses before this executor could inspect
    // them (same issue documented in the prospecting executor).
    tools: [webSearchTool({ searchContextSize: "high" })],
  });

  const request = `Research this product by visiting its real website:\n\nName: ${product.name}\nURL: ${product.url}`;

  let rawOutput: unknown;
  try {
    const result = await run(briefAgent, request, { maxTurns: 6 });

    await recordApiUsage({
      user_id: parent.user_id,
      source: "product_brief",
      model: MODEL,
      input_tokens: result.state.usage.inputTokens,
      output_tokens: result.state.usage.outputTokens,
    });

    rawOutput = result.finalOutput;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return {
      success: false,
      summary: `Could not research ${product.name}.`,
      errorMessage: message,
      transientFailure: true,
    };
  }

  const rawText = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
  const parsed = extractAndParseJson(rawText);
  const validation = BriefSchema.safeParse(parsed);

  if (!validation.success || !validation.data.found_content) {
    return {
      success: false,
      summary: `Could not gather meaningful content from ${product.url}.`,
      errorMessage: "The page could not be read or had no meaningful content.",
      transientFailure: true,
    };
  }

  const brief = validation.data;

  // Fold the ideal-prospect and competitor-exclusion research directly
  // into the audience field — this is exactly what buildProductContext()
  // reads and injects into every future prospecting run.
  const audienceWithFit = [
    brief.audience,
    brief.ideal_prospect_profile ? `Ideal prospect profile: ${brief.ideal_prospect_profile}` : null,
    brief.competitor_exclusions ? `NOT a prospect (competitor): ${brief.competitor_exclusions}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  await updateProductBrief(product.id, {
    problem: brief.problem || undefined,
    audience: audienceWithFit || undefined,
    positioning: brief.positioning || undefined,
    features: brief.features || undefined,
    commercial_model: brief.commercial_model || undefined,
    pricing: brief.pricing || undefined,
    cta: brief.cta || undefined,
  });

  return {
    success: true,
    summary: `Generated and saved a product brief for ${product.name}, grounded in ${product.url}.`,
    resultData: {
      product_id: product.id,
      product_name: product.name,
      brief,
    },
  };
}

export const productBriefExecutor: TaskExecutor = {
  taskType: "product_brief",

  planSubtasks(task: AgentTask): SubtaskPlanItem[] {
    return [
      {
        title: `Generate brief`,
        description: task.description ?? undefined,
      },
    ];
  },

  async runSubtask(parent: AgentTask, _subtask: AgentTask): Promise<StepResult> {
    return generateBrief(parent);
  },
};
