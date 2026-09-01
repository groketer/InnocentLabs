import { getDb } from "@/lib/db";
import { getProductByName } from "@/lib/models/products";
import type { Product } from "@/lib/types";

interface StoredTask {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  result_summary: string | null;
  result_json: string | null;
  result_reference: string | null;
}

export interface ProductIntelligence {
  product: Product;

  audit: {
    task_id: string;
    title: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    summary: string | null;
    result: Record<string, unknown> | null;
  } | null;

  intelligence: {
    problem: string | null;
    audience: string | null;
    positioning: string | null;
    features: string | null;
    commercial_model: string | null;
    pricing: string | null;
    cta: string | null;
    confidence: number | null;
    unknowns: string[];
  };

  evidence: {
    stored: string | null;
    source_url: string | null;
    last_audited_at: string | null;
  };
}

/**
 * Safely parse JSON stored by the task engine.
 *
 * The database may contain older task results whose shape differs from
 * newer audit results, so retrieval must remain tolerant rather than
 * assuming one exact historical structure.
 */
function parseResultJson(
  value: string | null
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }

    return null;
  } catch {
    return null;
  }
}

function parseUnknowns(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    // Older records may contain plain text rather than JSON.
  }

  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findLatestAudit(product: Product): StoredTask | null {
  const db = getDb();

  /*
   * Website audits are stored as parent tasks and/or subtasks.
   *
   * We deliberately search by product identity and task type rather than
   * assuming a particular task hierarchy. This allows the retrieval layer
   * to work with both portfolio audits and individually requested audits.
   */
  const rows = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        task_type,
        status,
        created_at,
        completed_at,
        result_summary,
        result_json,
        result_reference
      FROM agent_tasks
      WHERE task_type = 'website_audit'
        AND (
          title = @exact_title
          OR title = @audit_title
          OR description LIKE @url_pattern
          OR description LIKE @product_pattern
        )
        AND status IN ('COMPLETED', 'COMPLETED_WITH_ISSUES')
      ORDER BY COALESCE(completed_at, created_at) DESC
    `)
    .all({
      exact_title: product.name,
      audit_title: `Audit ${product.name}`,
      url_pattern: product.url
        ? `%${product.url}%`
        : `%__NO_URL__%`,
      product_pattern: `%${product.name}%`,
    }) as StoredTask[];

  return rows[0] ?? null;
}

/**
 * Returns the authoritative product record together with the most recent
 * website-audit evidence available for that product.
 *
 * This function does not perform a new audit.
 * It retrieves persisted intelligence only.
 */
export function getProductIntelligence(
  productName: string
): ProductIntelligence | null {
  const product = getProductByName(productName.trim());

  if (!product) {
    return null;
  }

  const auditTask = findLatestAudit(product);

  const auditResult = auditTask
    ? parseResultJson(auditTask.result_json)
    : null;

  const auditRecord = auditResult
    ? (
        auditResult.observation &&
        typeof auditResult.observation === "object"
          ? auditResult.observation
          : auditResult
      )
    : null;

  let sourceUrl: string | null = product.url;

  if (
    auditRecord &&
    typeof auditRecord === "object" &&
    "url" in auditRecord &&
    typeof auditRecord.url === "string"
  ) {
    sourceUrl = auditRecord.url;
  }

  return {
    product,

    audit: auditTask
      ? {
          task_id: auditTask.id,
          title: auditTask.title,
          status: auditTask.status,
          started_at: null,
          completed_at: auditTask.completed_at,
          summary: auditTask.result_summary,
          result: auditResult,
        }
      : null,

    intelligence: {
      problem: product.problem,
      audience: product.audience,
      positioning: product.positioning,
      features: product.features,
      commercial_model: product.commercial_model,
      pricing: product.pricing,
      cta: product.cta,
      confidence: product.confidence,
      unknowns: parseUnknowns(product.unknowns),
    },

    evidence: {
      stored: product.evidence,
      source_url: sourceUrl,
      last_audited_at: product.last_audited_at,
    },
  };
}