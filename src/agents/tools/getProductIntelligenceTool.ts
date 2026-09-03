/**
 * Product intelligence retrieval tool.
 *
 * This tool is deliberately read-only. It gives the master agent access to
 * intelligence that Innocent Intelligence has actually persisted.
 *
 * The tool distinguishes:
 *
 * - authoritative portfolio information;
 * - durable product-intelligence fields;
 * - the latest persisted website audit;
 * - explicit unknowns;
 * - confidence;
 * - source URL and audit timestamp.
 *
 * Milestone 3D.7 hardening:
 *
 * - defensive JSON parsing;
 * - defensive serialization;
 * - clear distinction between "not found" and "no audit";
 * - no inference from missing fields;
 * - no external research;
 * - no mutation of product data.
 */

import { tool } from "@openai/agents";
import { z } from "zod";

import {
  getProductByName,
  getLatestWebsiteAuditResult,
} from "@/lib/models/products";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_PRODUCT_NAME_LENGTH = 500;
const MAX_RESULT_TEXT_LENGTH = 60_000;

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Safely parses a JSON array persisted in a TEXT column.
 *
 * Older records may contain:
 * - valid JSON arrays;
 * - a single JSON value;
 * - plain text;
 * - null/empty values;
 * - malformed JSON.
 *
 * The retrieval tool must never crash merely because one persisted field is
 * malformed.
 */
function parseJsonArray(
  value: string | null | undefined
): unknown[] {
  if (
    value === null ||
    value === undefined ||
    !value.trim()
  ) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    return [parsed];
  } catch {
    return [value];
  }
}

/**
 * Safely converts a value to a bounded string.
 *
 * This is mainly defensive because persisted task-result data can be much
 * larger than expected.
 */
function cleanString(
  value: unknown,
  maxLength = MAX_RESULT_TEXT_LENGTH
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(/\u0000/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

/**
 * Safely serializes tool output.
 *
 * JSON.stringify normally succeeds for the structures used here, but keeping
 * this boundary defensive prevents a malformed nested value from turning a
 * retrieval operation into an unhandled tool failure.
 */
function safeStringify(
  value: unknown
): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      found: false,
      error:
        "Product intelligence could not be serialized safely.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Tool                                                                       */
/* -------------------------------------------------------------------------- */

export const getProductIntelligenceTool = tool({
  name: "get_product_intelligence",

  description: `
Retrieve the authoritative portfolio record and the latest persisted website
intelligence for one Innocent Labs product.

Use this tool whenever Innocent asks what the system knows about a specific
product, especially after a website audit or other intelligence task has
completed.

The result separates:

- baseline portfolio facts supplied by Innocent;
- durable intelligence fields stored on the product record;
- the latest direct website observation, when an audit exists;
- explicit unknowns;
- audit confidence;
- source URL and audit timestamp.

IMPORTANT:

- This is a READ-ONLY retrieval tool.
- It does not perform new web research.
- It does not perform a new website visit.
- It does not create or modify tasks.
- It does not modify product records.
- It returns only information actually persisted in the portfolio database.
- Never claim that an audit happened merely because the product exists.
- If there is no completed audit, say so plainly.
- If a field is empty or null, treat it as unknown.
- Never manufacture missing product features, pricing, audience, positioning,
  market demand, competitive position or business performance.
- A website observation is evidence about what was observed on the website;
  it is not automatically proof of the underlying business claim.
`,

  parameters: z.object({
    product_name: z
      .string()
      .min(1)
      .max(MAX_PRODUCT_NAME_LENGTH)
      .describe(
        'Exact or near-exact Innocent Labs product name, e.g. "Tiny Wins".'
      ),
  }),

  execute: async ({ product_name }) => {
    const requested =
      product_name.trim();

    if (!requested) {
      return safeStringify({
        found: false,
        product_name: "",
        message:
          "A product name is required.",
      });
    }

    const product =
      await getProductByName(requested);

    if (!product) {
      return safeStringify({
        found: false,
        product_name: requested,
        message:
          "No product with that exact name exists in the authoritative portfolio database.",
      });
    }

    let latestAudit = null;

    /*
     * Audit retrieval is isolated from the baseline product record.
     *
     * If the product exists but its audit record is malformed or unavailable,
     * the agent should still be able to retrieve the authoritative product
     * record rather than failing the entire tool call.
     */
    try {
      latestAudit =
        await getLatestWebsiteAuditResult(
          product.name
        );
    } catch {
      latestAudit = null;
    }

    const result = {
      found: true,

      product: {
        id: product.id,
        name: product.name,
        url: product.url,
        status: product.status,
        asset_type: product.asset_type,
        category: product.category,
        description: product.description,
        future_url: product.future_url,
        notes: product.notes,
      },

      intelligence_record: {
        problem: product.problem,
        audience: product.audience,
        positioning: product.positioning,
        features: product.features,
        commercial_model:
          product.commercial_model,
        pricing: product.pricing,
        cta: product.cta,
        evidence: product.evidence,
        unknowns: parseJsonArray(
          product.unknowns
        ),
        confidence: product.confidence,
        last_audited_at:
          product.last_audited_at,
      },

      latest_website_audit: latestAudit
        ? {
            task_id:
              cleanString(
                latestAudit.task_id,
                200
              ),

            task_status:
              cleanString(
                latestAudit.task_status,
                100
              ),

            completed_at:
              cleanString(
                latestAudit.completed_at,
                100
              ),

            result_summary:
              cleanString(
                latestAudit.result_summary
              ),

            result_data:
              latestAudit.result_data,
          }
        : null,
    };

    return safeStringify(result);
  },
});