/**
 * Website Intelligence Executor
 * ------------------------------
 *
 * Milestone 3B foundation.
 *
 * This executor turns a website audit from a simple availability check into
 * an evidence-preserving intelligence-gathering operation.
 *
 * IMPORTANT DESIGN PRINCIPLE:
 *
 * The executor observes.
 * The intelligence layer reasons.
 *
 * This file must NEVER invent facts about a product. It may detect signals
 * from the website, but it should preserve those signals as observations and
 * explicitly record what remains unknown.
 *
 * Autonomous actions performed here are limited to:
 *   - fetching public website pages
 *   - inspecting publicly visible HTML
 *   - extracting observable signals
 *   - storing those observations in the local database
 *
 * It does NOT:
 *   - submit forms
 *   - create accounts
 *   - purchase anything
 *   - contact prospects
 *   - send emails
 *   - change website content
 *   - make commercial commitments
 */

import { randomUUID } from "crypto";

import type { AgentTask, Product } from "@/lib/types";

import type {
  StepResult,
  SubtaskPlanItem,
  TaskExecutor,
} from "../types";

import {
  listProductsWithUrl,
  getProductByName,
} from "@/lib/models/products";

const FETCH_TIMEOUT_MS = 10_000;

const RETRYABLE_STATUS = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const MAX_HTML_CHARS = 2_000_000;
const MAX_TEXT_CHARS = 30_000;
const MAX_LINKS_TO_STORE = 100;

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function extractUrl(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const match = description.match(/URL:\s*(\S+)/i);
  return match ? match[1] : null;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(
  html: string,
  regex: RegExp
): string | null {
  const match = html.match(regex);

  if (!match?.[1]) {
    return null;
  }

  return clean(
    decodeHtmlEntities(
      match[1].replace(/<[^>]+>/g, "")
    )
  );
}

function extractMetaDescription(
  html: string
): string | null {
  return (
    extractTag(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
    ) ??
    extractTag(
      html,
      /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i
    )
  );
}

function extractCanonicalUrl(
  html: string
): string | null {
  return (
    extractTag(
      html,
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
    ) ??
    extractTag(
      html,
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i
    )
  );
}

function extractHeadings(
  html: string
): string[] {
  const matches = [
    ...html.matchAll(
      /<h1[^>]*>([\s\S]*?)<\/h1>/gi
    ),
    ...html.matchAll(
      /<h2[^>]*>([\s\S]*?)<\/h2>/gi
    ),
    ...html.matchAll(
      /<h3[^>]*>([\s\S]*?)<\/h3>/gi
    ),
  ];

  return matches
    .map((match) =>
      clean(
        decodeHtmlEntities(
          match[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
        )
      )
    )
    .filter(Boolean)
    .slice(0, 30);
}

function extractLinks(
  html: string,
  baseUrl: string
): Array<{ text: string; href: string }> {
  const links: Array<{
    text: string;
    href: string;
  }> = [];

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    if (links.length >= MAX_LINKS_TO_STORE) {
      break;
    }

    const rawHref = clean(match[1]);

    const text = clean(
      decodeHtmlEntities(
        match[2].replace(/<[^>]+>/g, " ")
      )
    );

    if (!rawHref) {
      continue;
    }

    let href: string;

    try {
      href = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }

    links.push({
      text: text.slice(0, 200),
      href,
    });
  }

  return links;
}

function extractEmails(
  html: string
): string[] {
  const matches = html.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );

  return Array.from(
    new Set(matches ?? [])
  ).slice(0, 20);
}

function extractPhoneNumbers(
  html: string
): string[] {
  const text = stripHtml(html);

  const matches = text.match(
    /\+?\d[\d\s().-]{7,}\d/g
  );

  return Array.from(
    new Set(
      (matches ?? [])
        .map(clean)
        .filter(
          (value) =>
            value.replace(/\D/g, "").length >= 8
        )
    )
  ).slice(0, 20);
}

function countMatches(
  text: string,
  patterns: RegExp[]
): number {
  return patterns.reduce(
    (count, pattern) =>
      count + (text.match(pattern)?.length ?? 0),
    0
  );
}

/* -------------------------------------------------------------------------- */
/* Signal detection                                                           */
/* -------------------------------------------------------------------------- */

interface DetectedSignals {
  pricing: {
    detected: boolean;
    evidence: string[];
  };

  callsToAction: {
    detected: boolean;
    evidence: string[];
  };

  audience: {
    detected: boolean;
    evidence: string[];
  };

  problem: {
    detected: boolean;
    evidence: string[];
  };

  commercialModel: {
    detected: boolean;
    evidence: string[];
  };

  socialProof: {
    detected: boolean;
    evidence: string[];
  };

  authentication: {
    detected: boolean;
    evidence: string[];
  };
}

function detectSignals(
  visibleText: string,
  links: Array<{
    text: string;
    href: string;
  }>
): DetectedSignals {
  const text = visibleText.toLowerCase();

  const pricingPatterns = [
    /\$\s?\d+/g,
    /usd\s?\d+/gi,
    /ksh\s?\d+/gi,
    /kes\s?\d+/gi,
    /\bprice\b/gi,
    /\bpricing\b/gi,
    /\bsubscription\b/gi,
    /\bmonthly\b/gi,
    /\byearly\b/gi,
    /\bper month\b/gi,
    /\bper year\b/gi,
    /\bfree trial\b/gi,
    /\bfree plan\b/gi,
  ];

  const ctaPatterns = [
    /\bsign up\b/gi,
    /\bget started\b/gi,
    /\bstart now\b/gi,
    /\bjoin now\b/gi,
    /\btry it\b/gi,
    /\btry free\b/gi,
    /\bbook now\b/gi,
    /\bbook a call\b/gi,
    /\bcontact us\b/gi,
    /\blearn more\b/gi,
    /\bbuy now\b/gi,
    /\bsubscribe\b/gi,
    /\bapply now\b/gi,
    /\bdownload\b/gi,
    /\bcreate account\b/gi,
  ];

  const audiencePatterns = [
    /\bfor entrepreneurs\b/gi,
    /\bfor creators\b/gi,
    /\bfor students\b/gi,
    /\bfor businesses\b/gi,
    /\bfor professionals\b/gi,
    /\bfor teams\b/gi,
    /\bfor agencies\b/gi,
    /\bfor coaches\b/gi,
    /\bfor marketers\b/gi,
    /\bfor developers\b/gi,
    /\bfor writers\b/gi,
    /\bfor real estate agents\b/gi,
    /\bfor property agents\b/gi,
    /\bfor couples\b/gi,
    /\bfor individuals\b/gi,
    /\bfor you\b/gi,
  ];

  const problemPatterns = [
    /\bproblem\b/gi,
    /\bstruggle\b/gi,
    /\bstruggling\b/gi,
    /\bchallenge\b/gi,
    /\bfrustrat/gi,
    /\bdifficult\b/gi,
    /\bhard to\b/gi,
    /\bwithout\b/gi,
    /\bstop\b/gi,
    /\bavoid\b/gi,
    /\bsolve\b/gi,
    /\bsolution\b/gi,
  ];

  const commercialPatterns = [
    /\bsubscription\b/gi,
    /\bmembership\b/gi,
    /\bplan\b/gi,
    /\bpackage\b/gi,
    /\bcourse\b/gi,
    /\bcoaching\b/gi,
    /\bconsulting\b/gi,
    /\bservice\b/gi,
    /\blicense\b/gi,
    /\bsoftware\b/gi,
    /\bsaas\b/gi,
    /\bmarketplace\b/gi,
    /\bcommission\b/gi,
  ];

  const socialProofPatterns = [
    /\btestimonial\b/gi,
    /\btestimonials\b/gi,
    /\bcustomers\b/gi,
    /\bclients\b/gi,
    /\btrusted by\b/gi,
    /\bused by\b/gi,
    /\bpeople\b/gi,
    /\busers\b/gi,
    /\breviews\b/gi,
    /\bresults\b/gi,
    /\bsuccess stories\b/gi,
  ];

  const authPatterns = [
    /\blogin\b/gi,
    /\blog in\b/gi,
    /\bsign in\b/gi,
    /\bsign up\b/gi,
    /\bcreate account\b/gi,
    /\bregister\b/gi,
    /\bdashboard\b/gi,
  ];

  const evidenceFromMatches = (
    patterns: RegExp[]
  ): string[] => {
    const results: string[] = [];

    for (const pattern of patterns) {
      const matches = text.match(pattern);

      if (matches?.length) {
        results.push(
          `${pattern.source} detected`
        );
      }
    }

    return results.slice(0, 10);
  };

  const linkText = links
    .map((link) => link.text)
    .filter(Boolean);

  const ctaLinkEvidence = linkText.filter(
    (value) =>
      /get started|sign up|join|try|book|contact|buy|subscribe|apply|download/i.test(
        value
      )
  );

  return {
    pricing: {
      detected:
        countMatches(
          visibleText,
          pricingPatterns
        ) > 0,

      evidence:
        evidenceFromMatches(
          pricingPatterns
        ),
    },

    callsToAction: {
      detected:
        countMatches(
          visibleText,
          ctaPatterns
        ) > 0 ||
        ctaLinkEvidence.length > 0,

      evidence: [
        ...evidenceFromMatches(
          ctaPatterns
        ),

        ...ctaLinkEvidence
          .slice(0, 10)
          .map(
            (value) =>
              `CTA link text: "${value}"`
          ),
      ].slice(0, 15),
    },

    audience: {
      detected:
        countMatches(
          visibleText,
          audiencePatterns
        ) > 0,

      evidence:
        evidenceFromMatches(
          audiencePatterns
        ),
    },

    problem: {
      detected:
        countMatches(
          visibleText,
          problemPatterns
        ) > 0,

      evidence:
        evidenceFromMatches(
          problemPatterns
        ),
    },

    commercialModel: {
      detected:
        countMatches(
          visibleText,
          commercialPatterns
        ) > 0,

      evidence:
        evidenceFromMatches(
          commercialPatterns
        ),
    },

    socialProof: {
      detected:
        countMatches(
          visibleText,
          socialProofPatterns
        ) > 0,

      evidence:
        evidenceFromMatches(
          socialProofPatterns
        ),
    },

    authentication: {
      detected:
        countMatches(
          visibleText,
          authPatterns
        ) > 0,

      evidence:
        evidenceFromMatches(
          authPatterns
        ),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Evidence / intelligence construction                                       */
/* -------------------------------------------------------------------------- */

interface WebsiteObservation {
  url: string;
  final_url: string;
  http_status: number;
  content_type: string;
  response_time_ms: number;
  html_size: number;
  title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  headings: string[];
  homepage_link_count: number;

  links: Array<{
    text: string;
    href: string;
  }>;

  emails: string[];
  phone_numbers: string[];
  visible_text_sample: string;

  signals: DetectedSignals;

  evidence_type:
    | "DIRECT_WEBSITE_OBSERVATION";

  observed_at: string;
}

/**
 * A normalized evidence item derived directly from one website observation.
 *
 * Evidence describes what was observed. It does not describe what the
 * observation means. Interpretation and inference belong to the intelligence
 * layer.
 */
interface EvidenceItem {
  id: string;

  evidence_type:
    | "DIRECT_WEBSITE_OBSERVATION";

  source_type: "website";

  source_url: string;

  observed_at: string;

  observation: string;

  confidence: number;
}

/**
 * Converts the raw website observation into normalized evidence items.
 *
 * This establishes a clean boundary between observation, evidence, and future
 * interpretation. It deliberately does not infer audience, positioning,
 * market, quality, competitiveness, value, or any other higher-level
 * conclusion.
 */
function buildEvidenceItems(
  observation: WebsiteObservation
): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  const add = (
    observationText: string,
    confidence = 1
  ) => {
    if (!observationText.trim()) {
      return;
    }

    items.push({
      id: `web-${randomUUID()}`,

      evidence_type:
        "DIRECT_WEBSITE_OBSERVATION",

      source_type: "website",

      source_url:
        observation.final_url,

      observed_at:
        observation.observed_at,

      observation:
        observationText.trim(),

      confidence: Math.max(
        0,
        Math.min(1, confidence)
      ),
    });
  };

  add(
    `HTTP response status was ${observation.http_status}.`
  );

  add(
    `The final URL after redirects was ${observation.final_url}.`
  );

  add(
    `The response content type was ${
      observation.content_type || "unknown"
    }.`
  );

  add(
    `The response took ${observation.response_time_ms} milliseconds.`
  );

  add(
    `The retrieved HTML contained ${observation.html_size} characters.`
  );

  if (observation.title) {
    add(
      `The homepage title was "${observation.title}".`
    );
  }

  if (observation.meta_description) {
    add(
      `The homepage meta description was "${observation.meta_description}".`
    );
  }

  if (observation.canonical_url) {
    add(
      `The homepage declared the canonical URL as "${observation.canonical_url}".`
    );
  }

  for (const heading of observation.headings.slice(
    0,
    30
  )) {
    add(
      `The homepage contained the heading "${heading}".`
    );
  }

  add(
    `The homepage contained ${observation.homepage_link_count} detected links.`
  );

  for (const link of observation.links.slice(
    0,
    100
  )) {
    if (link.text) {
      add(
        `The homepage contained a link labelled "${link.text}" pointing to "${link.href}".`
      );
    } else {
      add(
        `The homepage contained a link pointing to "${link.href}".`
      );
    }
  }

  for (const email of observation.emails) {
    add(
      `The homepage contained the publicly visible email address "${email}".`
    );
  }

  for (const phone of observation.phone_numbers) {
    add(
      `The homepage contained the publicly visible phone number "${phone}".`
    );
  }

  const signalGroups: Array<{
    name: string;
    signal: {
      detected: boolean;
      evidence: string[];
    };
  }> = [
    {
      name: "pricing",
      signal:
        observation.signals.pricing,
    },
    {
      name: "calls to action",
      signal:
        observation.signals.callsToAction,
    },
    {
      name: "audience language",
      signal:
        observation.signals.audience,
    },
    {
      name: "problem/solution language",
      signal:
        observation.signals.problem,
    },
    {
      name: "commercial model language",
      signal:
        observation.signals.commercialModel,
    },
    {
      name: "social proof language",
      signal:
        observation.signals.socialProof,
    },
    {
      name: "authentication/account language",
      signal:
        observation.signals.authentication,
    },
  ];

  for (const group of signalGroups) {
    if (!group.signal.detected) {
      continue;
    }

    add(
      `The homepage contained detectable ${group.name} signals: ${group.signal.evidence.join(
        "; "
      )}.`,
      0.85
    );
  }

  return items;
}

function buildUnknowns(
  product: Product,
  observation: WebsiteObservation
): string[] {
  const unknowns: string[] = [];

  if (!observation.title) {
    unknowns.push(
      "Homepage title could not be detected."
    );
  }

  if (!observation.meta_description) {
    unknowns.push(
      "Homepage meta description could not be detected."
    );
  }

  if (!observation.headings.length) {
    unknowns.push(
      "No meaningful homepage headings were detected."
    );
  }

  if (!observation.signals.audience.detected) {
    unknowns.push(
      "Target audience was not clearly detectable from the homepage."
    );
  }

  if (!observation.signals.problem.detected) {
    unknowns.push(
      "Customer problem/pain point was not clearly detectable from the homepage."
    );
  }

  if (!observation.signals.pricing.detected) {
    unknowns.push(
      "Pricing or a clear pricing model was not detectable from the homepage."
    );
  }

  if (!observation.signals.callsToAction.detected) {
    unknowns.push(
      "A clear call to action was not detectable from the homepage."
    );
  }

  if (!observation.signals.commercialModel.detected) {
    unknowns.push(
      "Commercial model was not clearly detectable from the homepage."
    );
  }

  if (!observation.signals.socialProof.detected) {
    unknowns.push(
      "Customer/social proof was not clearly detectable from the homepage."
    );
  }

  if (product.notes) {
    unknowns.push(
      "Existing portfolio notes may require verification against the current website."
    );
  }

  return unknowns;
}

function calculateConfidence(
  observation: WebsiteObservation,
  unknowns: string[]
): number {
  let score = 0.25;

  if (observation.title) {
    score += 0.10;
  }

  if (observation.meta_description) {
    score += 0.10;
  }

  if (observation.headings.length > 0) {
    score += 0.10;
  }

  if (observation.signals.audience.detected) {
    score += 0.10;
  }

  if (observation.signals.problem.detected) {
    score += 0.10;
  }

  if (observation.signals.callsToAction.detected) {
    score += 0.08;
  }

  if (observation.signals.pricing.detected) {
    score += 0.07;
  }

  if (observation.signals.commercialModel.detected) {
    score += 0.05;
  }

  if (observation.signals.socialProof.detected) {
    score += 0.05;
  }

  score -= Math.min(
    0.25,
    unknowns.length * 0.02
  );

  return Math.max(
    0,
    Math.min(
      1,
      Number(score.toFixed(2))
    )
  );
}

function buildEvidenceText(
  observation: WebsiteObservation
): string {
  const evidence: string[] = [];

  evidence.push(
    `Direct website observation at ${observation.observed_at}.`
  );

  evidence.push(
    `HTTP ${observation.http_status}; final URL: ${observation.final_url}; response time: ${observation.response_time_ms}ms.`
  );

  if (observation.title) {
    evidence.push(
      `Homepage title: "${observation.title}".`
    );
  }

  if (observation.meta_description) {
    evidence.push(
      `Meta description: "${observation.meta_description}".`
    );
  }

  if (observation.headings.length) {
    evidence.push(
      `Homepage headings: ${observation.headings
        .slice(0, 10)
        .map(
          (heading) => `"${heading}"`
        )
        .join("; ")}.`
    );
  }

  evidence.push(
    `${observation.homepage_link_count} homepage links detected.`
  );

  if (observation.signals.pricing.detected) {
    evidence.push(
      `Pricing/commercial-price signals detected: ${observation.signals.pricing.evidence.join(
        "; "
      )}.`
    );
  }

  if (observation.signals.callsToAction.detected) {
    evidence.push(
      `CTA signals detected: ${observation.signals.callsToAction.evidence.join(
        "; "
      )}.`
    );
  }

  if (observation.signals.audience.detected) {
    evidence.push(
      `Audience signals detected: ${observation.signals.audience.evidence.join(
        "; "
      )}.`
    );
  }

  if (observation.signals.problem.detected) {
    evidence.push(
      `Problem/solution language detected: ${observation.signals.problem.evidence.join(
        "; "
      )}.`
    );
  }

  if (observation.signals.commercialModel.detected) {
    evidence.push(
      `Commercial model signals detected: ${observation.signals.commercialModel.evidence.join(
        "; "
      )}.`
    );
  }

  if (observation.signals.socialProof.detected) {
    evidence.push(
      `Social-proof signals detected: ${observation.signals.socialProof.evidence.join(
        "; "
      )}.`
    );
  }

  return evidence.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Database enrichment                                                        */
/* -------------------------------------------------------------------------- */

function persistObservation(
  product: Product,
  observation: WebsiteObservation,
  unknowns: string[],
  confidence: number
): void {
  const db = require("@/lib/db").getDb();

  const existingEvidence = product.evidence
    ? `${product.evidence}\n\n`
    : "";

  const evidence = `${existingEvidence}${buildEvidenceText(
    observation
  )}`;

  db.prepare(`
    UPDATE products
    SET
      evidence = @evidence,
      unknowns = @unknowns,
      confidence = @confidence,
      last_audited_at = @last_audited_at,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: product.id,

    evidence,

    unknowns:
      JSON.stringify(unknowns),

    confidence,

    last_audited_at:
      observation.observed_at,

    updated_at:
      observation.observed_at,
  });
}

/* -------------------------------------------------------------------------- */
/* Executor                                                                   */
/* -------------------------------------------------------------------------- */

export const websiteAuditExecutor: TaskExecutor = {
  taskType: "website_audit",

  /**
   * A portfolio audit is automatically decomposed into one subtask per
   * eligible product.
   *
   * The task engine then executes exactly one product observation at a time.
   */
  planSubtasks(
    task: AgentTask
  ): SubtaskPlanItem[] {
    const requestedProduct =
      extractRequestedProductName(task);

    if (requestedProduct) {
      const product =
        getProductByName(
          requestedProduct
        );

      if (!product || !product.url) {
        return [];
      }

      return [
        {
          title: `Audit ${product.name}`,

          description: [
            `Product: ${product.name}`,
            `URL: ${product.url}`,
            `Asset type: ${product.asset_type}`,
            `Category: ${product.category}`,
          ].join("\n"),
        },
      ];
    }

    return listProductsWithUrl().map(
      (product) => ({
        title: `Audit ${product.name}`,

        description: [
          `Product: ${product.name}`,
          `URL: ${product.url}`,
          `Asset type: ${product.asset_type}`,
          `Category: ${product.category}`,
        ].join("\n"),
      })
    );
  },

  /**
   * Inspect one public website and preserve what was actually observed.
   */
  async runSubtask(
    _task: AgentTask,
    subtask: AgentTask
  ): Promise<StepResult> {
    const url = extractUrl(
      subtask.description
    );

    if (!url) {
      return {
        success: false,

        summary:
          "No URL on record for this product.",

        errorMessage:
          "Missing URL",

        transientFailure: false,
      };
    }

    const product =
      getProductByName(
        extractProductName(
          subtask.title
        )
      );

    if (!product) {
      return {
        success: false,

        summary:
          "The product could not be found in the authoritative portfolio.",

        errorMessage:
          "Product not found in portfolio.",

        transientFailure: false,
      };
    }

    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS
    );

    try {
      const start = Date.now();

      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,

        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Innocent-Intelligence/3.1; +https://innocent.co.ke)",

          Accept:
            "text/html,application/xhtml+xml",
        },
      });

      const elapsedMs =
        Date.now() - start;

      const finalUrl =
        res.url || url;

      if (!res.ok) {
        const retryable =
          RETRYABLE_STATUS.has(
            res.status
          );

        return {
          success: false,

          summary:
            `Returned HTTP ${res.status} after following redirects (${elapsedMs}ms).`,

          errorMessage:
            `HTTP ${res.status}`,

          transientFailure:
            retryable,

          resultData: {
            url,

            final_url:
              finalUrl,

            http_status:
              res.status,

            response_time_ms:
              elapsedMs,

            evidence_type:
              "DIRECT_WEBSITE_OBSERVATION",

            observed_at:
              nowIso(),
          },
        };
      }

      const contentType =
        res.headers.get(
          "content-type"
        ) ?? "";

      /**
       * Some legitimate product URLs may point to PDFs, images or other
       * resources. They are reachable, but they are not homepage HTML.
       */
      if (
        !contentType.includes(
          "text/html"
        ) &&
        !contentType.includes(
          "application/xhtml+xml"
        )
      ) {
        const observedAt =
          nowIso();

        return {
          success: true,

          summary:
            `Reachable but not an HTML page (${contentType || "unknown content type"}; HTTP ${res.status}, ${elapsedMs}ms).`,

          resultData: {
            url,

            final_url:
              finalUrl,

            http_status:
              res.status,

            content_type:
              contentType || null,

            response_time_ms:
              elapsedMs,

            evidence_type:
              "DIRECT_WEBSITE_OBSERVATION",

            observed_at:
              observedAt,

            intelligence_status:
              "reachable_but_not_html",
          },
        };
      }

      let html =
        await res.text();

      if (
        html.length >
        MAX_HTML_CHARS
      ) {
        html =
          html.slice(
            0,
            MAX_HTML_CHARS
          );
      }

      const title =
        extractTag(
          html,
          /<title[^>]*>([\s\S]*?)<\/title>/i
        );

      const metaDescription =
        extractMetaDescription(
          html
        );

      const canonicalUrl =
        extractCanonicalUrl(
          html
        );

      const headings =
        extractHeadings(
          html
        );

      const links =
        extractLinks(
          html,
          finalUrl
        );

      const emails =
        extractEmails(
          html
        );

      const phoneNumbers =
        extractPhoneNumbers(
          html
        );

      let visibleText =
        stripHtml(html);

      if (
        visibleText.length >
        MAX_TEXT_CHARS
      ) {
        visibleText =
          visibleText.slice(
            0,
            MAX_TEXT_CHARS
          );
      }

      const signals =
        detectSignals(
          visibleText,
          links
        );

      const observation:
        WebsiteObservation = {
        url,

        final_url:
          finalUrl,

        http_status:
          res.status,

        content_type:
          contentType,

        response_time_ms:
          elapsedMs,

        html_size:
          html.length,

        title,

        meta_description:
          metaDescription,

        canonical_url:
          canonicalUrl,

        headings,

        homepage_link_count:
          links.length,

        links,

        emails,

        phone_numbers:
          phoneNumbers,

        visible_text_sample:
          visibleText.slice(
            0,
            5000
          ),

        signals,

        evidence_type:
          "DIRECT_WEBSITE_OBSERVATION",

        observed_at:
          nowIso(),
      };

      const unknowns =
        buildUnknowns(
          product,
          observation
        );

      const confidence =
        calculateConfidence(
          observation,
          unknowns
        );

      persistObservation(
        product,
        observation,
        unknowns,
        confidence
      );

      const detectedSignals:
        string[] = [];

      if (
        signals.pricing.detected
      ) {
        detectedSignals.push(
          "pricing"
        );
      }

      if (
        signals.callsToAction
          .detected
      ) {
        detectedSignals.push(
          "CTA"
        );
      }

      if (
        signals.audience.detected
      ) {
        detectedSignals.push(
          "audience"
        );
      }

      if (
        signals.problem.detected
      ) {
        detectedSignals.push(
          "problem/solution"
        );
      }

      if (
        signals.commercialModel
          .detected
      ) {
        detectedSignals.push(
          "commercial model"
        );
      }

      if (
        signals.socialProof
          .detected
      ) {
        detectedSignals.push(
          "social proof"
        );
      }

      const signalSummary =
        detectedSignals.length > 0
          ? ` Signals detected: ${detectedSignals.join(
              ", "
            )}.`
          : " No major commercial signals were confidently detected.";

      return {
        success: true,

        summary:
          `Homepage intelligence collected for ${product.name}: ` +
          `HTTP ${res.status}, ${elapsedMs}ms, ` +
          `${headings.length} headings, ` +
          `${links.length} links, ` +
          `${unknowns.length} explicit unknowns, ` +
          `confidence ${confidence}.${signalSummary}`,

        resultData: {
          product_name:
            product.name,

          observation,

          evidence:
            buildEvidenceItems(
              observation
            ),

          intelligence: {
            confidence,

            unknowns,

            direct_observations: {
              title,

              meta_description:
                metaDescription,

              canonical_url:
                canonicalUrl,

              headings,

              homepage_link_count:
                links.length,

              emails,

              phone_numbers:
                phoneNumbers,
            },

            detected_signals:
              signals,
          },

          evidence_type:
            "DIRECT_WEBSITE_OBSERVATION",

          observed_at:
            observation.observed_at,
        },
      };
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        err.name === "AbortError";

      const message = isAbort
        ? `No response within ${
            FETCH_TIMEOUT_MS / 1000
          }s (timeout).`
        : err instanceof Error
        ? err.message
        : "Unknown network error.";

      return {
        success: false,

        summary:
          `Could not inspect ${product.name} — ${message}`,

        errorMessage:
          message,

        /**
         * Network failures are normally transient. The task engine already
         * has exponential retry/backoff, so the executor simply reports the
         * nature of the failure.
         */
        transientFailure: true,

        resultData: {
          product_name:
            product.name,

          url,

          evidence_type:
            "DIRECT_WEBSITE_OBSERVATION",

          observed_at:
            nowIso(),
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The task planner creates titles in the form:
 *
 *   Audit Tiny Wins
 *
 * This helper converts that back into the authoritative product name.
 *
 * Keeping the product name tied to the database rather than trusting the
 * subtask title prevents a malformed task from accidentally updating the
 * wrong product.
 */
function extractRequestedProductName(
  task: AgentTask
): string | null {
  /**
   * The task title is the strongest signal of the requested target.
   *
   * Examples:
   *   "Audit Tiny Wins" -> Tiny Wins
   *   "Audit Inno" -> Inno
   *   "Audit Innocent Labs Portfolio Websites" -> portfolio request
   *
   * The description is used only as a fallback. This prevents incidental
   * mentions of another product or of "Innocent Labs" inside a description
   * from overriding an explicit product named in the task title.
   */
  const title =
    (task.title ?? "").trim();

  const description =
    (task.description ?? "").trim();

  if (!title && !description) {
    return null;
  }

  const products =
    listProductsWithUrl();

  /**
   * Match longer product names first.
   *
   * This matters for names such as:
   *   "Groketer"
   *   "Groketer Mail Drip"
   *   "Inno"
   *
   * A complete-word match prevents "Inno" from matching "Innocent".
   */
  const matchProductName = (
    text: string
  ): string | null => {
    const normalizedText =
      text.toLowerCase();

    const matches = products
      .filter((product) => {
        const productName =
          product.name
            .trim()
            .toLowerCase();

        if (!productName) {
          return false;
        }

        const escapedName =
          productName.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

        const pattern =
          new RegExp(
            `(^|[^a-z0-9])${escapedName}(?=$|[^a-z0-9])`,
            "i"
          );

        return pattern.test(
          normalizedText
        );
      })
      .sort(
        (a, b) =>
          b.name.length -
          a.name.length
      );

    return (
      matches[0]?.name ??
      null
    );
  };

  /**
   * FIRST: inspect the task title.
   *
   * A specific product named in the title always takes precedence over
   * generic portfolio language elsewhere in the task.
   */
  const titleProduct =
    matchProductName(title);

  if (titleProduct) {
    return titleProduct;
  }

  /**
   * If the title explicitly describes a portfolio-wide request, return null.
   *
   * Returning null tells the audit executor that this is not a request
   * targeting one particular product.
   */
  const portfolioPatterns = [
    /\binnocent\s+labs\b/i,
    /\bportfolio\b/i,
    /\ball\s+(?:current\s+)?(?:innocent\s+labs\s+)?products\b/i,
    /\bentire\s+(?:innocent\s+labs\s+)?portfolio\b/i,
    /\bwhole\s+(?:innocent\s+labs\s+)?portfolio\b/i,
    /\bevery\s+(?:innocent\s+labs\s+)?product\b/i,
  ];

  if (
    portfolioPatterns.some(
      (pattern) =>
        pattern.test(title)
    )
  ) {
    return null;
  }

  /**
   * SECOND: use the description as a fallback.
   *
   * This supports tasks where the product isn't included in the title but
   * is clearly identified in the task description.
   */
  const descriptionProduct =
    matchProductName(
      description
    );

  if (descriptionProduct) {
    return descriptionProduct;
  }

  /**
   * Finally, recognize portfolio-level language in the description.
   */
  if (
    portfolioPatterns.some(
      (pattern) =>
        pattern.test(description)
    )
  ) {
    return null;
  }

  return null;
}

function extractProductName(
  title: string
): string {
  return title
    .replace(
      /^Audit\s+/i,
      ""
    )
    .trim();
}