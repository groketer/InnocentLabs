/**
 * Prospecting Executor
 * --------------------
 *
 * Milestone 3D - Evidence-based prospect discovery.
 *
 * This executor performs genuine external research using the OpenAI Agents
 * SDK hosted web-search tool.
 *
 * The executor is responsible for:
 * - maintaining live awareness of the Innocent Labs marketplace;
 * - discovering newly listed Innocent Labs products;
 * - identifying the Innocent Labs product involved;
 * - discovering potential prospects;
 * - evaluating candidates against explicit evidence requirements;
 * - distinguishing individual and organizational prospects;
 * - requiring legitimate public email contactability;
 * - persisting evidence-backed prospect records.
 *
 * It does NOT:
 * - contact prospects;
 * - send emails;
 * - submit forms;
 * - create accounts;
 * - make purchases;
 * - make commercial commitments;
 * - claim that a prospect has buying intent without evidence.
 *
 * IMPORTANT DESIGN PRINCIPLE:
 *
 * The agent discovers and evaluates.
 * The persistence layer stores only the structured result that passes
 * validation.
 *
 * Prospecting is evidence-based investigation, not advocacy.
 *
 * MILESTONE 3D HARDENING:
 *
 * The Agents SDK structured-output boundary is deliberately NOT used for
 * prospecting output.
 *
 * Previous executions failed because the SDK rejected the model's final
 * response before the executor could inspect it. We therefore request
 * ordinary JSON text and validate it locally.
 *
 * LIVE PORTFOLIO AWARENESS:
 *
 * Every prospecting execution checks https://innocent.co.ke.
 *
 * Products explicitly observed on the live Innocent Marketplace are reconciled
 * into the local portfolio through upsertDiscoveredPortfolioProduct().
 *
 * That function deliberately updates only portfolio identity fields and does
 * not overwrite deeper intelligence such as:
 * - problem;
 * - audience;
 * - positioning;
 * - features;
 * - pricing;
 * - evidence;
 * - unknowns;
 * - confidence;
 * - last_audited_at.
 *
 * EMAIL-FIRST PROSPECTING:
 *
 * Milestone 3D persists only contactable prospects.
 *
 * A prospect must therefore have a legitimate publicly published email address
 * actually established during research.
 *
 * The executor never:
 * - guesses email addresses;
 * - infers email patterns;
 * - fabricates addresses;
 * - uses private/non-public contact information.
 */

import { Agent, run, webSearchTool } from "@openai/agents";
import { z } from "zod";

import type { AgentTask } from "@/lib/types";
import type { StepResult, SubtaskPlanItem, TaskExecutor } from "../types";

import { getDb } from "@/lib/db";

import {
  getProductByName,
  listProductsWithUrl,
  upsertDiscoveredPortfolioProduct,
} from "@/lib/models/products";

import {
  createProspect,
  listProspects,
  type Prospect,
  type ProspectType,
} from "@/lib/models/prospects";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MODEL = "gpt-4.1-mini";

// MILESTONE 3E — VERCEL: this was 10. Each agent turn with live web search
// can take 5-15+ seconds, so 10 turns could take 60-150+ seconds — which
// routinely exceeded /api/tasks/tick's 60s Vercel function limit and left
// the subtask (and sometimes its parent) stuck in RUNNING with no chance
// to save a result. 6 keeps a single step's realistic worst case
// comfortably under the limit. If you want deeper per-prospect research
// than 6 turns reliably allows, the tradeoff is real: either accept
// somewhat shallower research per step, or move to a Vercel plan with a
// higher function duration limit and raise both this and maxDuration in
// src/app/api/tasks/tick/route.ts and src/app/api/cron/daily/route.ts to
// match.
const MAX_TURNS = 6;

const LIVE_PORTFOLIO_REFRESH_MAX_TURNS = 6;

const MAX_CONTEXT_CHARS = 40_000;

const MAX_OUTPUT_CHARS = 60_000;

/**
 * MAX_PROSPECTS_PER_ROUND is a ceiling per round, not a quota.
 */
// MILESTONE 3E — VERCEL: web_prospecting used to be one single-shot runTask()
// call targeting "up to 10" prospects. Finding 20+ evidence-backed,
// verified-email prospects via live web search genuinely needs more
// searching than fits in one ~60s Vercel function invocation (see the
// MAX_TURNS comment above — turns were cut from 10 to 6 specifically to
// stop timeouts). Rather than reintroduce timeouts by just raising the
// target, web_prospecting now runs as several smaller "rounds"
// (planSubtasks/runSubtask, the same pattern executors/websiteAudit.ts
// already uses), each a bounded, independent agent run that fits safely in
// one invocation. Rounds accumulate toward the overall target because each
// round is told which prospects earlier rounds already found and asked for
// different ones. PROSPECTING_ROUNDS × MAX_PROSPECTS_PER_ROUND gives
// meaningful headroom above 20 to absorb duplicates and candidates without
// a verifiable public email.
const PROSPECTING_ROUNDS = 4;
const MAX_PROSPECTS_PER_ROUND = 8;

/**
 * Defensive upper bound on evidence items stored for one prospect.
 */
const MAX_EVIDENCE_ITEMS_PER_PROSPECT = 10;

/**
 * The live marketplace is always checked during prospecting.
 */
const INNOCENT_MARKETPLACE_URL =
  "https://innocent.co.ke";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ProspectCandidate {
  name: string;

  organization?: string;

  role?: string;

  /**
   * Legitimate, publicly published contact email discovered during research.
   *
   * This is deliberately first-class because Milestone 3D is
   * contactability-first.
   */
  email?: string;

  prospect_type: ProspectType | string;

  qualification_status?:
    | "candidate"
    | "qualified"
    | "unqualified"
    | "needs_review"
    | string;

  website?: string;

  public_profile_url?: string;

  fit_reason?: string;

  opportunity_signal?: string;

  evidence?: Array<{
    observation: string;
    source: string;
    observed_at?: string;
  }>;

  confidence?: number;

  unknowns?: string[];
}

interface ProspectingOutput {
  prospects: ProspectCandidate[];

  search_objective?: string;

  qualification_method?: string;

  evidence_gaps?: string[];
}

interface LivePortfolioProduct {
  name: string;

  url: string;

  listing_source_url: string;

  category?: string;

  description?: string;
}

interface LivePortfolioRefreshResult {
  discovered: LivePortfolioProduct[];

  skipped: string[];

  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Local structured-output schemas                                            */
/* -------------------------------------------------------------------------- */

/**
 * IMPORTANT:
 *
 * These schemas are NOT passed to Agent.outputType.
 *
 * They are local validation boundaries applied after run() returns.
 */

const ProspectingEvidenceSchema = z.object({
  observation: z.string(),

  source: z.string(),

  observed_at: z.string().optional(),
});

const ProspectCandidateSchema = z.object({
  name: z.string(),

  organization: z.string().optional(),

  role: z.string().optional(),

  email: z.string().optional(),

  prospect_type: z.enum([
    "person",
    "organization",
    "partner",
    "investor",
    "customer",
    "publisher",
    "other",
  ]),

  qualification_status: z
    .enum([
      "candidate",
      "qualified",
      "unqualified",
      "needs_review",
    ])
    .optional(),

  website: z.string().optional(),

  public_profile_url: z.string().optional(),

  fit_reason: z.string(),

  opportunity_signal: z.string(),

  evidence: z.array(
    ProspectingEvidenceSchema
  ),

  confidence: z.number(),

  unknowns: z.array(z.string()),
});

const ProspectingOutputSchema = z.object({
  search_objective: z.string().optional(),

  qualification_method:
    z.string().optional(),

  evidence_gaps:
    z.array(z.string()).optional(),

  prospects: z.array(
    ProspectCandidateSchema
  ),
});

const LivePortfolioProductSchema = z.object({
  name: z.string(),

  url: z.string(),

  listing_source_url: z.string(),

  category: z.string().optional(),

  description: z.string().optional(),
});

const LivePortfolioRefreshSchema = z.object({
  products: z.array(
    LivePortfolioProductSchema
  ),

  evidence_gaps:
    z.array(z.string()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Utility functions                                                           */
/* -------------------------------------------------------------------------- */

function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, MAX_OUTPUT_CHARS);
}

function normalizeWhitespace(
  value: string
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function getTaskContext(
  task: AgentTask
): string {
  const title =
    (task.title ?? "").trim();

  const description =
    (task.description ?? "").trim();

  const parts: string[] = [];

  if (title) {
    parts.push(
      `Task title:\n${title}`
    );
  }

  if (description) {
    parts.push(
      `Task description:\n${description}`
    );
  }

  return parts
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
}

/**
 * Returns true only for an actual HTTP(S) URL.
 */
function isValidHttpUrl(
  value: string
): boolean {
  try {
    const url = new URL(
      value.trim()
    );

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

/**
 * Returns true only for URLs whose hostname belongs to the
 * Innocent Marketplace.
 */
function isInnocentMarketplaceUrl(
  value: string
): boolean {
  try {
    const url = new URL(
      value.trim()
    );

    const hostname =
      url.hostname.toLowerCase();

    return (
      (
        hostname ===
          "innocent.co.ke" ||
        hostname ===
          "www.innocent.co.ke"
      ) &&
      (
        url.protocol === "http:" ||
        url.protocol === "https:"
      )
    );
  } catch {
    return false;
  }
}

/**
 * Extracts an explicitly supplied product name.
 *
 * Supported form:
 *
 * Product: PRFed
 */
function extractExplicitProductName(
  task: AgentTask
): string | null {
  const context =
    getTaskContext(task);

  const match =
    context.match(
      /(?:^|\n)\s*Product\s*:\s*([^\n\r]+)/i
    );

  if (!match?.[1]) {
    return null;
  }

  const value =
    match[1].trim();

  return value || null;
}

/**
 * Resolves a product name against the current local Innocent Labs portfolio.
 *
 * Never uses unrestricted substring matching.
 */
async function resolvePortfolioProduct(
  requestedName: string
): Promise<
  Awaited<ReturnType<typeof getProductByName>>
> {
  const requested =
    requestedName.trim();

  if (!requested) {
    return null;
  }

  const products =
    await listProductsWithUrl();

  const exact =
    products.find(
      (product) =>
        product.name
          .trim()
          .toLowerCase() ===
        requested.toLowerCase()
    );

  if (exact) {
    return getProductByName(
      exact.name
    );
  }

  const normalizedRequested =
    normalizeWhitespace(
      requested
    ).toLowerCase();

  const normalized =
    products.find(
      (product) =>
        normalizeWhitespace(
          product.name
        ).toLowerCase() ===
        normalizedRequested
    );

  if (normalized) {
    return getProductByName(
      normalized.name
    );
  }

  return null;
}

/**
 * Identifies a product already known locally.
 *
 * Identification order:
 *
 * 1. Explicit Product: field.
 * 2. Exact/boundary-aware product-name mention.
 * 3. Otherwise null.
 */
async function extractProductName(
  task: AgentTask
): Promise<string | null> {
  const context =
    getTaskContext(task);

  const explicit =
    extractExplicitProductName(
      task
    );

  if (explicit) {
    const resolved =
      await resolvePortfolioProduct(
        explicit
      );

    return (
      resolved?.name ?? null
    );
  }

  const products =
    await listProductsWithUrl();

  const matches =
    products.filter(
      (product) => {
        const name =
          product.name.trim();

        if (!name) {
          return false;
        }

        const escaped =
          name.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );

        const pattern =
          new RegExp(
            `(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`,
            "i"
          );

        return pattern.test(
          context
        );
      }
    );

  if (
    matches.length === 1
  ) {
    return matches[0].name;
  }

  return null;
}

/**
 * Extracts a product hint even when the product is not yet in the local
 * registry.
 *
 * This is only a hint. The live marketplace refresh must establish the
 * product before it becomes authoritative for the execution.
 */
async function extractRequestedProductHint(
  task: AgentTask
): Promise<string | null> {
  const explicit =
    extractExplicitProductName(
      task
    );

  if (explicit) {
    return normalizeWhitespace(
      explicit
    );
  }

  const existing =
    await extractProductName(task);

  if (existing) {
    return existing;
  }

  const title =
    (task.title ?? "").trim();

  const description =
    (task.description ?? "").trim();

  const context =
    `${title}\n${description}`;

  const patterns = [
    /(?:research|prospecting|prospect)\s+(?:prospects?\s+)?for\s+([^\n\r]+)/i,
    /(?:prospects?|research)\s+for\s+([^\n\r]+)/i,
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      context.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const value =
      match[1]
        .replace(
          /\s+by\s+Innocent\s+Mwangi.*$/i,
          ""
        )
        .replace(
          /\s+AUTHORITATIVE.*$/i,
          ""
        )
        .trim();

    if (value) {
      return normalizeWhitespace(
        value
      );
    }
  }

  return null;
}

/**
 * Autonomously picks a product to prospect for when the task didn't name
 * one and none could be inferred from its title/description.
 *
 * This is what lets the agent operate proactively rather than failing with
 * "does not identify one unambiguous Innocent Labs product" every time a
 * prospecting task doesn't spell out a product by name. It's a rotation,
 * not a judgment call: pick whichever eligible portfolio product currently
 * has the fewest persisted prospects, so autonomous/repeated prospecting
 * naturally cycles through the whole portfolio over time instead of only
 * ever working the same one or two products. Ties break alphabetically for
 * determinism.
 *
 * listProductsWithUrl() already excludes the Innocent Marketplace hub
 * record itself (asset_type "hub") and anything discontinued, so this can
 * never select Innocent Labs' own umbrella listing as "the product to
 * market" — only real, individual portfolio products are eligible.
 */
async function autoSelectProductForProspecting(): Promise<string | null> {
  const products = await listProductsWithUrl();

  if (products.length === 0) {
    return null;
  }

  const db = await getDb();

  const countsResult = await db.execute(
    `SELECT product_id, COUNT(*) as c FROM prospects WHERE product_id IS NOT NULL GROUP BY product_id`
  );

  const counts = new Map<string, number>(
    (
      countsResult.rows as unknown as Array<{
        product_id: string;
        c: number | string;
      }>
    ).map((row) => [row.product_id, Number(row.c)])
  );

  const sorted = [...products].sort((a, b) => {
    const diff = (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  return sorted[0].name;
}

/**
 * Resolves a product hint against the now-refreshed local portfolio.
 *
 * This supports the important Milestone 3D case where a product is found
 * on innocent.co.ke during the same execution that requested it.
 */
async function resolveProductHint(
  hint: string
): Promise<
  Awaited<ReturnType<typeof getProductByName>>
> {
  const exact =
    await resolvePortfolioProduct(
      hint
    );

  if (exact) {
    return exact;
  }

  const normalizedHint =
    normalizeWhitespace(
      hint
    ).toLowerCase();

  if (!normalizedHint) {
    return null;
  }

  const products =
    await listProductsWithUrl();

  const matches =
    products.filter(
      (product) => {
        const name =
          normalizeWhitespace(
            product.name
          ).toLowerCase();

        return (
          name ===
            normalizedHint ||
          normalizedHint.startsWith(
            `${name}:`
          ) ||
          name.startsWith(
            `${normalizedHint}:`
          )
        );
      }
    );

  if (
    matches.length === 1
  ) {
    return matches[0];
  }

  return null;
}

function buildProductContext(
  product: Awaited<ReturnType<
    typeof getProductByName
  >>
): string {
  if (!product) {
    return "";
  }

  return `
TARGET INNOCENT LABS PRODUCT

Name: ${product.name}
URL: ${product.url ?? "Unknown"}
Asset type: ${product.asset_type}
Category: ${product.category}
Description: ${product.description ?? "Unknown"}
Problem: ${product.problem ?? "Unknown"}
Audience: ${product.audience ?? "Unknown"}
Positioning: ${product.positioning ?? "Unknown"}
Features: ${product.features ?? "Unknown"}
Commercial model: ${product.commercial_model ?? "Unknown"}
Pricing: ${product.pricing ?? "Unknown"}
CTA: ${product.cta ?? "Unknown"}

IMPORTANT:

Empty or unknown fields above are genuinely unknown.

Do not fill them with assumptions.
`;
}

/* -------------------------------------------------------------------------- */
/* Live Innocent Marketplace refresh                                           */
/* -------------------------------------------------------------------------- */

/**
 * The marketplace refresh is deliberately a separate agent action.
 *
 * This means:
 *
 * 1. live marketplace awareness happens before prospect qualification;
 * 2. newly discovered products can become locally known immediately;
 * 3. the prospecting agent receives the resulting authoritative product;
 * 4. deeper product intelligence is left untouched.
 */
async function refreshLivePortfolio():
  Promise<LivePortfolioRefreshResult> {
  const existingProductsList =
    await listProductsWithUrl();
  const existingProducts =
    existingProductsList.map(
      (product) =>
        `${product.name} | ${product.url}`
    );

  const refreshAgent =
    new Agent({
      name:
        "Innocent Intelligence Marketplace Portfolio Refresh Agent",

      model: MODEL,

      instructions: `
You maintain live awareness of the Innocent Labs portfolio.

You MUST inspect the public Innocent Marketplace at:

${INNOCENT_MARKETPLACE_URL}

using the web-search tool before returning your result.

Your job is to identify product listings that are explicitly present on the
marketplace and return them as structured JSON.

The marketplace is the source of truth for LIVE LISTING OBSERVATION.

Do not assume that the local database is complete.

CURRENT LOCAL PRODUCT REGISTRY

${
  existingProducts.join("\n") ||
  "(empty)"
}

RULES

- Inspect innocent.co.ke itself.
- Do not rely only on third-party search results.
- A product qualifies only when its listing can be supported by a page or
  listing URL on innocent.co.ke.
- Do not invent product names.
- Do not invent product URLs.
- Do not include "Innocent Marketplace" itself as a product.
- Return products already known as well as newly observed products when the
  marketplace clearly lists them.
- A listing may link to an external product URL. That external URL may be used
  as the product URL, but the listing_source_url MUST be on innocent.co.ke.
- This is portfolio observation only.
- Do not make claims about demand, popularity, sales, revenue, customers,
  buying intent, or commercial performance.
- The executor will reconcile only portfolio identity fields.
- Do not attempt outreach or interaction with any listing.

RETURN EXACTLY ONE JSON OBJECT

{
  "products": [
    {
      "name": "string",
      "url": "https://example.com",
      "listing_source_url": "https://innocent.co.ke/...",
      "category": "string",
      "description": "string"
    }
  ],
  "evidence_gaps": ["string"]
}

Do not use Markdown fences.
Do not add commentary outside the JSON.
`,

      tools: [
        webSearchTool({
          searchContextSize: "high",
        }),
      ],
    });

  try {
    const result =
      await run(
        refreshAgent,
        `
Inspect ${INNOCENT_MARKETPLACE_URL} now.

Identify the current Innocent Labs product listings and return the required
JSON object.
`,
        {
          maxTurns:
            LIVE_PORTFOLIO_REFRESH_MAX_TURNS,
        }
      );

    const raw =
      result.finalOutput;

    const jsonText =
      extractJsonText(raw);

    if (!jsonText) {
      return {
        discovered: [],
        skipped: [],
        error:
          "Live marketplace refresh returned no valid JSON.",
      };
    }

    let parsedJson: unknown;

    try {
      parsedJson =
        JSON.parse(jsonText);
    } catch {
      return {
        discovered: [],
        skipped: [],
        error:
          "Live marketplace refresh returned malformed JSON.",
      };
    }

    const validation =
      LivePortfolioRefreshSchema.safeParse(
        parsedJson
      );

    if (!validation.success) {
      return {
        discovered: [],
        skipped: [],
        error:
          "Live marketplace refresh returned an invalid structure.",
      };
    }

    const discovered:
      LivePortfolioProduct[] = [];

    const skipped: string[] =
      [];

    for (
      const product of
        validation.data.products
    ) {
      const name =
        normalizeWhitespace(
          product.name
        );

      const url =
        product.url.trim();

      const source =
        product.listing_source_url.trim();

      if (
        !name ||
        !isValidHttpUrl(url) ||
        !isInnocentMarketplaceUrl(
          source
        )
      ) {
        skipped.push(
          name ||
            "Unnamed product"
        );

        continue;
      }

      try {
        /**
         * IMPORTANT:
         *
         * This existing portfolio helper deliberately updates only identity
         * fields. It does not overwrite deeper product intelligence.
         */
        upsertDiscoveredPortfolioProduct(
          {
            name,

            url,

            category:
              product.category,

            description:
              product.description,

            status: "active",

            notes:
              `Observed as a live Innocent Marketplace listing at ${source} on ${new Date().toISOString()}.`,
          }
        );

        discovered.push({
          name,

          url,

          listing_source_url:
            source,

          category:
            product.category,

          description:
            product.description,
        });
      } catch {
        skipped.push(name);
      }
    }

    return {
      discovered,

      skipped,
    };
  } catch (error) {
    return {
      discovered: [],

      skipped: [],

      error:
        error instanceof Error
          ? error.message
          : "Unknown live marketplace refresh error.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Prospecting instructions                                                    */
/* -------------------------------------------------------------------------- */

function buildInstructions(): string {
  return `
You are the dedicated Prospecting Agent for Innocent Intelligence.

Your job is to discover POTENTIALLY RELEVANT PROSPECTS using genuine external
web research and publicly observable evidence.

You are NOT a salesperson.

Your responsibility is evidence-based investigation, not advocacy.

==================================================
PROSPECTING SCOPE
==================================================

This is REAL prospecting.

A prospect may be:

1. AN ORGANIZATION

Examples include:

- companies;
- startups;
- publishers;
- agencies;
- NGOs;
- associations;
- institutions;
- potential partners;
- potential investors;
- potential customers.

2. AN INDIVIDUAL

Examples include:

- founders;
- CEOs;
- executives;
- entrepreneurs;
- authors;
- creators;
- consultants;
- professionals;
- investors;
- speakers;
- coaches;
- researchers;
- other identifiable people.

==================================================
PROSPECTING ALWAYS LOOKS OUTWARD
==================================================

A prospect is always someone OUTSIDE the Innocent Labs ecosystem — a member
of the market Innocent Labs could sell to.

A prospect is NEVER:

- Innocent Labs itself;
- Innocent Mwangi;
- any other Innocent Labs product;
- any Innocent Labs team member, page, or listing.

Innocent Labs and its portfolio are what you are marketing FOR — the thing
being strategized about — never a candidate to be discovered AS a prospect.

==================================================
SEARCH LIKE IT MATTERS — NOT JUST THE OBVIOUS QUERY
==================================================

A generic search ("companies that need [category] software") tends to
surface only the most visible, most already-targeted organizations —
everyone else doing this kind of prospecting finds the same names. Within
the evidence rules below (never fabricate, never infer beyond what a
source establishes), search for signal, not just category membership:

- Recent, dated triggers: funding announcements, expansions, new office
  openings, leadership changes, product launches — moments that plausibly
  create the specific need this product addresses right now, not just
  "this company is in the right industry."
- Visible pain, stated directly: public complaints, negative reviews of a
  competing product or approach, forum/community posts describing the
  exact problem, job postings that describe a gap this product could fill.
- Adjacency instead of overlap: users or customers of a complementary
  (non-competing) product, where the audience overlap is real but nobody
  else is looking there because it's not the obvious search term.
- A specific, named, dated observation beats a category match. "This
  company posted on [date] about [specific problem]" is far stronger
  evidence than "this company is a mid-size firm in a relevant industry."

None of this loosens the evidence or email rules elsewhere in these
instructions — a creative angle still needs a real, cited, dated public
source, exactly like any other observation. The point is where you look
and what you search for, not how much you're allowed to claim once you
find something.

Do NOT assume prospecting means finding companies only.

For some Innocent Labs products, an individual may be the most appropriate
prospect.

If an individual is identified through an organization, distinguish the person
from the organization.

Do not invent a role merely because someone appears associated with an
organization.

==================================================
CORE DEFINITION OF A PROSPECT
==================================================

A prospect is NOT simply a real organization or person.

A real entity becomes a prospect only when public evidence supports ALL of:

1. The entity is real and reasonably identifiable.

2. The entity is relevant to the TARGET INNOCENT LABS PRODUCT.

3. There is a concrete observable opportunity, need, activity, event, or
   circumstance that makes the product plausibly relevant.

4. The evidence supports the opportunity signal.

5. The fit_reason can be stated without inventing facts.

6. A legitimate publicly published email address has been established.

A generic organization that merely belongs to the target product's industry is
NOT automatically a prospect.

A large company is NOT automatically a prospect.

A famous person is NOT automatically a prospect.

A professional title is NOT automatically evidence of prospect status.

A company having a website, social presence, marketing activity, or public
relations activity is NOT automatically evidence of prospect status.

A person being successful, influential, wealthy, famous, or professionally
active is NOT automatically evidence.

A company or individual being "likely to need" something is NOT evidence.

You must find a specific observable signal that makes the entity potentially
relevant NOW or in a clearly identifiable current circumstance.

==================================================
OBSERVATION VS INTERPRETATION
==================================================

Separate OBSERVATION from INTERPRETATION.

Observation:

"The organization announced its expansion into three new markets in 2026."

Interpretation:

"This expansion creates a plausible context in which the product may be
relevant."

Do NOT convert the interpretation into an alleged fact.

Never write:

"The organization needs the product."

Instead write:

"The organization announced a major expansion initiative, which creates a
plausible context in which the product may be relevant."

Never claim:

- the prospect wants the product;
- the prospect needs the product;
- the prospect will buy;
- the prospect has purchasing intent;
- the prospect has allocated a budget;

unless public evidence explicitly supports the claim.

==================================================
TARGET PRODUCT
==================================================

The TARGET INNOCENT LABS PRODUCT section supplied in the task request is
authoritative.

Research ONLY prospects relevant to that product.

Do not substitute another Innocent Labs product.

Do not infer a different target product.

Empty or unknown product fields remain unknown.

==================================================
WEB RESEARCH
==================================================

You MUST use the web-search tool.

Actually investigate the prospect.

For organizations, investigate the actual organization.

For individuals, investigate the actual person.

Prefer:

- official organization websites;
- official announcements;
- official company news;
- investor/company announcements;
- credible publications;
- industry sources;
- professional directories;
- authoritative public profiles;
- official biographies;
- reputable interviews;
- credible reporting.

Do not invent:

- people;
- organizations;
- URLs;
- roles;
- needs;
- problems;
- statistics;
- quotations;
- purchasing intent;
- budgets;
- decision-makers;
- email addresses.

Do not treat a search-result snippet alone as sufficient evidence when the
underlying source can be investigated.

==================================================
STRONG OPPORTUNITY SIGNALS
==================================================

For a book such as Patterns of Opportunity, useful signals may include:

- launching a company or product;
- entering a new market;
- announcing a strategic shift;
- raising funding;
- announcing a major partnership;
- publishing or promoting a book;
- leading an innovation initiative;
- publicly discussing opportunity recognition;
- publicly discussing business strategy;
- building an entrepreneurship practice;
- building a consulting or coaching practice;
- taking on a significant leadership role;
- creating entrepreneurship, innovation, leadership, strategy, or career
  development programmes;
- publicly discussing a relevant business challenge;
- another concrete public circumstance that creates plausible relevance.

These are examples, not requirements.

The signal must be supported by evidence.

Do NOT manufacture relevance merely because a category exists.

==================================================
QUALIFICATION
==================================================

For every candidate establish:

1. Identity
2. Prospect type
3. Relevance
4. Opportunity signal
5. Product fit
6. Evidence quality
7. Public email contactability
8. Unknowns

Use "qualified" only when there is meaningful evidence supporting both product
relevance and a concrete opportunity signal.

Use "candidate" or "needs_review" when the evidence is incomplete.

Use "unqualified" when the evidence does not support meaningful relevance.

Do NOT use "qualified" simply because the organization or individual looks
commercially interesting.

==================================================
EMAIL-FIRST CONTACTABILITY
==================================================

Milestone 3D is CONTACTABILITY-FIRST.

Only return a prospect when a legitimate publicly published email address has
been established during the research.

The email must be supported by a public source actually inspected by you.

Acceptable examples may include:

- an official organization contact page;
- an official staff/faculty/team profile;
- an official professional profile;
- a clearly public business contact page;
- another legitimate public source explicitly publishing the address.

DO NOT:

- guess an email;
- infer an email from a naming pattern;
- construct firstname.lastname@domain;
- use an inferred company address;
- fabricate an email;
- use private contact information;
- use leaked information;
- use non-public data.

If no legitimate public email can be established:

DO NOT include the prospect.

Email proves contactability.

Email does NOT prove buying intent.

==================================================
PUBLIC CONTACT INFORMATION
==================================================

If legitimately published public contact information is encountered during
research, it may be represented.

Do not fabricate email addresses.

Do not infer email-address patterns.

Do not collect private or non-public contact information.

Do not contact anyone.

==================================================
NO OUTREACH
==================================================

Research only.

Do NOT:

- send messages;
- send emails;
- submit contact forms;
- create accounts;
- purchase anything;
- make appointments;
- publish anything;
- modify external systems.

==================================================
PROSPECT COUNT
==================================================

Return UP TO ${MAX_PROSPECTS_PER_ROUND} strong prospects this round.

THIS IS A CEILING, NOT A QUOTA.

Do NOT pad the result.

It is better to return 2 strong contactable prospects than ${MAX_PROSPECTS_PER_ROUND} weak ones.

==================================================
EVIDENCE REQUIREMENT
==================================================

Every prospect must contain at least one concrete evidence item.

Each evidence item must contain:

- observation;
- source.

The observation must describe something actually supported by the source.

Every source must be a real HTTP or HTTPS URL.

The source must support the observation.

Where possible, use more than one source for important claims.

==================================================
EMAIL EVIDENCE
==================================================

The public email itself must be supported by the research.

If the email is found on a public page, include that page among the evidence
sources where appropriate.

Do not merely state that an email exists without establishing its public source.

==================================================
FIT REASON
==================================================

fit_reason must explain the connection between the observed evidence and the
TARGET INNOCENT LABS PRODUCT.

It must NOT claim buying intent.

Good:

"The founder has publicly launched a new venture and is actively discussing
business strategy. That creates a plausible context in which a book focused
on recognizing overlooked opportunities may be relevant."

Bad:

"The founder needs this book."

Bad:

"They are likely to buy the book."

==================================================
OPPORTUNITY SIGNAL
==================================================

opportunity_signal must describe the concrete observable circumstance that
makes this entity worth considering as a prospect.

Good:

"Founder publicly announced a new venture and described its strategy for
entering a new market in 2026."

Good:

"Consultant publicly launched a new entrepreneurship programme in 2026."

Bad:

"They need the book."

Bad:

"They probably need help."

==================================================
CONFIDENCE
==================================================

Confidence must be a number from 0 to 1.

It represents confidence in the evidence-based assessment.

It does NOT represent confidence that the prospect will buy.

==================================================
UNKNOWN INFORMATION
==================================================

Record important unknowns.

Examples:

- decision-maker not identified;
- purchasing authority unknown;
- budget unknown;
- current book or training supplier unknown;
- buying timeline unknown;
- direct product interest unknown;
- contact preference unknown.

Unknown information must remain unknown.

==================================================
OUTPUT FORMAT
==================================================

IMPORTANT:

Do NOT use the Agents SDK structured-output mechanism.

Your final response must instead be VALID JSON TEXT.

Return exactly one JSON object.

Do not use Markdown fences.

Do not add commentary before or after the JSON.

The JSON object must have this shape:

{
  "search_objective": "string",
  "qualification_method": "string",
  "evidence_gaps": ["string"],
  "prospects": [
    {
      "name": "string",
      "organization": "string",
      "role": "string",
      "email": "publicly published email address",
      "prospect_type": "person | organization | partner | investor | customer | publisher | other",
      "qualification_status": "candidate | qualified | unqualified | needs_review",
      "website": "string",
      "public_profile_url": "string",
      "fit_reason": "string",
      "opportunity_signal": "string",
      "evidence": [
        {
          "observation": "string",
          "source": "https://example.com",
          "observed_at": "string"
        }
      ],
      "confidence": 0.0,
      "unknowns": ["string"]
    }
  ]
}

Every prospect field must be present.

Use an empty string when a string value is genuinely unavailable.

Use an empty array when there are no items.

Do not invent missing values.

Because this is email-first prospecting, a genuinely unavailable email means the
candidate MUST NOT be included.

==================================================
FINAL QUALITY GATE
==================================================

Before returning the JSON result, verify EVERY proposed prospect.

Ask:

1. Is this a real identifiable entity?

2. Did I actually research it?

3. Is it relevant to the TARGET PRODUCT?

4. Do I have a concrete opportunity / need signal?

5. Is that signal supported by evidence?

6. Is the product fit a reasonable interpretation rather than a claimed fact?

7. Does every evidence source contain an actual HTTP/HTTPS URL?

8. Have I separated observation from interpretation?

9. Have I recorded important unknowns?

10. Have I avoided inventing facts?

11. Have I avoided claiming buying intent?

12. Have I avoided outreach?

13. Is the prospect an individual or organization appropriately represented?

14. Is there a legitimate publicly published email address supported by
    research evidence?

15. Would I still call this entity a prospect if I removed the sentence saying
    that it "could benefit" from the product?

If the answer to question 15 is NO, DO NOT include the entity.

It is better to return 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, or 10 strong contactable
prospects than to pad the result with weak organizations or individuals.

Return only the prospects that survive this standard.
`;
}

/* -------------------------------------------------------------------------- */
/* Model-output parsing                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Extracts ordinary JSON text defensively.
 *
 * The model is instructed to return JSON only, but hosted web research can
 * occasionally result in Markdown fences or surrounding text.
 */
function extractJsonText(
  value: unknown
): string | null {
  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const cleaned =
    value
      .replace(
        /\u0000/g,
        ""
      )
      .trim();

  if (!cleaned) {
    return null;
  }

  try {
    JSON.parse(cleaned);

    return cleaned;
  } catch {
    // Continue.
  }

  const unfenced =
    cleaned
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /\s*```$/i,
        ""
      )
      .trim();

  try {
    JSON.parse(unfenced);

    return unfenced;
  } catch {
    // Continue.
  }

  const firstBrace =
    unfenced.indexOf("{");

  const lastBrace =
    unfenced.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    return null;
  }

  const candidate =
    unfenced
      .slice(
        firstBrace,
        lastBrace + 1
      )
      .trim();

  try {
    JSON.parse(candidate);

    return candidate;
  } catch {
    return null;
  }
}

function parseProspectingOutput(
  value: unknown
): ProspectingOutput | null {
  const jsonText =
    extractJsonText(value);

  if (!jsonText) {
    return null;
  }

  try {
    const parsed: unknown =
      JSON.parse(jsonText);

    const validation =
      ProspectingOutputSchema.safeParse(
        parsed
      );

    if (
      !validation.success
    ) {
      return null;
    }

    return validation.data;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Candidate normalization                                                     */
/* -------------------------------------------------------------------------- */

function normalizeEvidence(
  item: unknown
): {
  observation: string;
  source: string;
  observed_at?: string;
} | null {
  if (
    !item ||
    typeof item !== "object"
  ) {
    return null;
  }

  const record =
    item as {
      observation?: unknown;
      source?: unknown;
      observed_at?: unknown;
    };

  if (
    typeof record.observation !==
      "string" ||
    !record.observation.trim()
  ) {
    return null;
  }

  if (
    typeof record.source !==
      "string" ||
    !record.source.trim() ||
    !isValidHttpUrl(
      record.source
    )
  ) {
    return null;
  }

  const evidence: {
    observation: string;
    source: string;
    observed_at?: string;
  } = {
    observation:
      normalizeWhitespace(
        record.observation
      ),

    source:
      record.source.trim(),
  };

  if (
    typeof record.observed_at ===
      "string" &&
    record.observed_at.trim()
  ) {
    evidence.observed_at =
      record.observed_at.trim();
  }

  return evidence;
}

function isValidProspectType(
  value: string
): boolean {
  return [
    "person",
    "organization",
    "partner",
    "investor",
    "customer",
    "publisher",
    "other",
  ].includes(value);
}

function isValidQualificationStatus(
  value: string
): boolean {
  return [
    "candidate",
    "qualified",
    "unqualified",
    "needs_review",
  ].includes(value);
}

/**
 * Conservative email syntax validation.
 *
 * This validates syntax only.
 *
 * It does NOT establish that the mailbox exists.
 *
 * Public provenance must come from the research evidence.
 */
function isValidEmailSyntax(
  value: string
): boolean {
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      value.trim()
    )
  );
}

/**
 * Normalizes and validates one model-produced prospect.
 *
 * Contactability is enforced here before persistence.
 */
function normalizeCandidate(
  candidate: ProspectCandidate
): ProspectCandidate | null {
  if (
    !candidate ||
    typeof candidate !== "object"
  ) {
    return null;
  }

  if (
    typeof candidate.name !==
      "string" ||
    !candidate.name.trim()
  ) {
    return null;
  }

  if (
    typeof candidate.prospect_type !==
      "string" ||
    !isValidProspectType(
      candidate.prospect_type
    )
  ) {
    return null;
  }

  const status =
    typeof candidate.qualification_status ===
      "string" &&
    isValidQualificationStatus(
      candidate.qualification_status
    )
      ? candidate.qualification_status
      : "candidate";

  const evidence =
    Array.isArray(
      candidate.evidence
    )
      ? candidate.evidence
          .map(
            normalizeEvidence
          )
          .filter(
            (
              item
            ): item is {
              observation: string;
              source: string;
              observed_at?: string;
            } =>
              item !== null
          )
          .slice(
            0,
            MAX_EVIDENCE_ITEMS_PER_PROSPECT
          )
      : [];

  if (
    evidence.length === 0
  ) {
    return null;
  }

  const fitReason =
    typeof candidate.fit_reason ===
      "string"
      ? cleanText(
          candidate.fit_reason
        )
      : "";

  if (!fitReason) {
    return null;
  }

  const opportunitySignal =
    typeof candidate.opportunity_signal ===
      "string"
      ? cleanText(
          candidate.opportunity_signal
        )
      : "";

  if (!opportunitySignal) {
    return null;
  }

  /**
   * Email is mandatory at the executor boundary.
   *
   * prospects.ts deliberately keeps the model-layer field optional, but
   * Milestone 3D task-generated prospects are contactable-only.
   */
  const email =
    typeof candidate.email ===
        "string" &&
      candidate.email.trim()
      ? candidate.email
          .trim()
          .toLowerCase()
      : undefined;

  if (
    !email ||
    !isValidEmailSyntax(
      email
    )
  ) {
    return null;
  }

  const confidence =
    typeof candidate.confidence ===
        "number" &&
      Number.isFinite(
        candidate.confidence
      )
      ? Math.min(
          Math.max(
            candidate.confidence,
            0
          ),
          1
        )
      : undefined;

  const organization =
    typeof candidate.organization ===
        "string" &&
      candidate.organization.trim()
      ? normalizeWhitespace(
          candidate.organization
        )
      : undefined;

  const role =
    typeof candidate.role ===
        "string" &&
      candidate.role.trim()
      ? normalizeWhitespace(
          candidate.role
        )
      : undefined;

  const website =
    typeof candidate.website ===
        "string" &&
      candidate.website.trim() &&
      isValidHttpUrl(
        candidate.website
      )
      ? candidate.website.trim()
      : undefined;

  const publicProfileUrl =
    typeof candidate.public_profile_url ===
        "string" &&
      candidate.public_profile_url.trim() &&
      isValidHttpUrl(
        candidate.public_profile_url
      )
      ? candidate.public_profile_url.trim()
      : undefined;

  const unknowns =
    Array.isArray(
      candidate.unknowns
    )
      ? candidate.unknowns
          .filter(
            (
              value
            ): value is string =>
              typeof value ===
                "string" &&
              value.trim()
                .length > 0
          )
          .map(
            (value) =>
              normalizeWhitespace(
                value
              )
          )
      : [];

  return {
    ...candidate,

    name:
      normalizeWhitespace(
        candidate.name
      ),

    organization,

    role,

    email,

    prospect_type:
      candidate.prospect_type,

    qualification_status:
      status,

    website,

    public_profile_url:
      publicProfileUrl,

    fit_reason:
      fitReason,

    opportunity_signal:
      opportunitySignal,

    evidence,

    confidence,

    unknowns,
  };
}

/**
 * Checks whether a prospect with the same basic identity has already been
 * persisted for this user and product.
 */
function isDuplicateProspect(
  existing: Prospect[],
  candidate: ProspectCandidate,
  productId?: string
): boolean {
  const candidateName =
    candidate.name
      .trim()
      .toLowerCase();

  const candidateOrganization =
    (
      candidate.organization ??
      ""
    )
      .trim()
      .toLowerCase();

  const candidateEmail =
    (
      candidate.email ??
      ""
    )
      .trim()
      .toLowerCase();

  return existing.some(
    (prospect) => {
      if (
        productId &&
        prospect.product_id !==
          productId
      ) {
        return false;
      }

      /**
       * Email is the strongest identity signal where available.
       */
      if (
        candidateEmail &&
        prospect.email &&
        prospect.email
          .trim()
          .toLowerCase() ===
          candidateEmail
      ) {
        return true;
      }

      if (
        prospect.name
          .trim()
          .toLowerCase() !==
        candidateName
      ) {
        return false;
      }

      return (
        (
          prospect.organization ??
          ""
        )
          .trim()
          .toLowerCase() ===
        candidateOrganization
      );
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Executor                                                                    */
/* -------------------------------------------------------------------------- */

export const prospectingExecutor:
  TaskExecutor = {
  taskType:
    "web_prospecting",

  async planSubtasks(
    task: AgentTask
  ): Promise<SubtaskPlanItem[]> {
    const taskContext =
      getTaskContext(task);

    if (
      !taskContext.trim()
    ) {
      // A task always has a title (createTask requires one), so this is a
      // defensive fallback rather than something expected to happen in
      // normal use — there's no context at all to prospect from.
      return [];
    }

    /* ---------------------------------------------------------------------- */
    /* Live Innocent Marketplace awareness                                    */
    /* ---------------------------------------------------------------------- */

    /**
     * IMPORTANT:
     *
     * This happens once per task, at planning time — not once per round —
     * since the discovered/updated portfolio doesn't change between rounds
     * of the SAME task and re-fetching it every round would just be wasted
     * work eating into each round's time budget.
     *
     * It restores the earlier requirement that prospecting remain aware of
     * newly listed products on innocent.co.ke.
     */
    const requestedProductHint =
      await extractRequestedProductHint(
        task
      );

    const portfolioRefresh =
      await refreshLivePortfolio();

    /* ---------------------------------------------------------------------- */
    /* Authoritative product identification                                   */
    /* ---------------------------------------------------------------------- */

    let productName =
      await extractProductName(task);

    /**
     * If the product wasn't previously in the local portfolio, try the
     * requested hint again AFTER the live marketplace refresh.
     */
    if (
      !productName &&
      requestedProductHint
    ) {
      const resolved =
        await resolveProductHint(
          requestedProductHint
        );

      if (resolved) {
        productName =
          resolved.name;
      }
    }

    /**
     * MILESTONE 3E — AUTONOMOUS OPERATION:
     *
     * Previously, a task that didn't explicitly name a product (or
     * couldn't be matched to one) simply failed with "does not identify
     * one unambiguous Innocent Labs product." That's the right behavior
     * for a genuinely ambiguous request where the person meant something
     * specific — but it made the agent unable to act on its own initiative
     * at all: every single prospecting task required a human to type an
     * exact, matchable product reference first.
     *
     * When nothing else identified a product, the executor now picks one
     * itself — see autoSelectProductForProspecting()'s doc comment for how
     * (a rotation favoring whichever product has the fewest prospects so
     * far, never Innocent Labs' own umbrella listing). This is a
     * deterministic, code-level decision made ONCE here before the agent
     * is ever invoked — the agent itself is still explicitly told not to
     * substitute a different product mid-run (see buildInstructions() and
     * the per-round request below), preserving the original safeguard
     * against the *model* silently drifting to a different product.
     */
    if (!productName) {
      productName =
        await autoSelectProductForProspecting();
    }

    if (!productName) {
      // Only reachable if the portfolio is genuinely empty — seed
      // products exist by default, so this should not happen in practice.
      return [];
    }

    const product =
      await getProductByName(
        productName
      );

    if (!product) {
      return [];
    }

    /**
     * This is the authoritative product identity used for the entire
     * task, across every round.
     *
     * No model output can replace it.
     */
    const items: SubtaskPlanItem[] = [];

    for (
      let round = 1;
      round <= PROSPECTING_ROUNDS;
      round++
    ) {
      items.push({
        title: `Prospecting round ${round} of ${PROSPECTING_ROUNDS} for ${product.name}`,
        description: `Product: ${product.name}\nRound: ${round} of ${PROSPECTING_ROUNDS}`,
      });
    }

    return items;
  },

  async runSubtask(
    parent: AgentTask,
    subtask: AgentTask
  ): Promise<StepResult> {
    const taskContext =
      getTaskContext(parent);

    const productMatch =
      subtask.description?.match(
        /Product:\s*([^\n\r]+)/
      );

    const productName =
      productMatch?.[1]?.trim();

    const roundMatch =
      subtask.description?.match(
        /Round:\s*(\d+)\s*of\s*(\d+)/i
      );

    const roundNumber =
      roundMatch?.[1] ?? "?";

    const totalRounds =
      roundMatch?.[2] ?? "?";

    const product =
      productName
        ? await getProductByName(
            productName
          )
        : null;

    if (!product) {
      return {
        success: false,

        summary:
          "The requested product could not be found in the authoritative portfolio.",

        errorMessage:
          `Product "${productName ?? "unknown"}" was not found in the authoritative portfolio.`,

        transientFailure: false,

        resultData: {
          prospecting_type:
            "web_prospecting",

          evidence_status:
            "product_not_found",

          requested_product:
            productName ?? null,

          task_id:
            subtask.id,
        },
      };
    }

    /**
     * This is the authoritative product identity used for this round.
     *
     * No model output can replace it.
     */
    const authoritativeProductId =
      product.id;

    const authoritativeProductName =
      product.name;

    /* ---------------------------------------------------------------------- */
    /* Existing prospects — fetched BEFORE the agent runs                     */
    /* ---------------------------------------------------------------------- */

    /**
     * Fetched up front (not just for post-hoc dedup like before) so this
     * round's prompt can explicitly tell the agent who earlier rounds
     * already found and ask for different ones. Without this, independent
     * rounds would have no way to avoid repeatedly rediscovering the same
     * handful of easy-to-find candidates.
     */
    const existing =
      await listProspects(
        parent.user_id,
        {
          product_id:
            authoritativeProductId,
        }
      );

    const alreadyFoundSummary =
      existing.length > 0
        ? existing
            .map(
              (p) =>
                `- ${p.name}${p.organization ? ` (${p.organization})` : ""}`
            )
            .join("\n")
        : "None yet — this is the first round for this product.";

    /* ---------------------------------------------------------------------- */
    /* Research request                                                       */
    /* ---------------------------------------------------------------------- */

    const request = `
Conduct the following prospecting task.

TASK CONTEXT

${taskContext}

${buildProductContext(product)}

AUTHORITATIVE PRODUCT IDENTITY

The target product for this task is:

${authoritativeProductName}

Its authoritative portfolio ID is:

${authoritativeProductId}

ROUND CONTEXT

This is round ${roundNumber} of ${totalRounds} of prospecting for this product within the same overall task.

PROSPECTS ALREADY FOUND IN EARLIER ROUNDS FOR THIS PRODUCT
(find NEW, DIFFERENT prospects — do not return any of these again):

${alreadyFoundSummary}

IMPORTANT:

- Research ONLY this product.
- Do not substitute another Innocent Labs product.
- Do not infer a different target product.
- The product identity above comes from the authoritative portfolio database.
- Empty or unknown product fields must remain unknown.
- The final result must describe prospects relevant to this product.
- A prospect is an external person or organization who might want or benefit
  from this product. A prospect is NEVER Innocent Labs itself, another
  Innocent Labs product, Innocent Mwangi, or anyone/anything already part of
  the Innocent Labs portfolio or team. Prospecting always looks outward, at
  the market Innocent Labs could sell to — never inward at Innocent Labs' own
  ecosystem.
- Prospects may be INDIVIDUALS or ORGANIZATIONS.
- Do not assume an organization is required.
- Actually perform web research.
- Return ONLY prospects with legitimate publicly published email addresses.
- Every email must have public provenance.
- Do not infer email addresses.
- Do not guess email addresses.
- Do not fabricate email addresses.
- Do not include a prospect without contactable public email evidence.
- Return UP TO ${MAX_PROSPECTS_PER_ROUND} strong prospects this round.
- This is a ceiling, not a quota.
- Do not pad the result with weak prospects.
- Do not repeat anyone listed above as already found.
- Do not perform outreach.

FINAL RESPONSE REQUIREMENT:

Return exactly one JSON object matching the output structure described in your
instructions.

Do not return Markdown fences.

Do not return explanatory prose outside the JSON object.
`;

    /* ---------------------------------------------------------------------- */
    /* Prospecting agent                                                      */
    /* ---------------------------------------------------------------------- */

    const prospectingAgent =
      new Agent({
        name:
          "Innocent Intelligence Prospecting Agent",

        model: MODEL,

        instructions:
          buildInstructions(),

        /**
         * IMPORTANT:
         *
         * Do NOT specify outputType here.
         *
         * The previous implementation used an SDK structured-output boundary
         * which could reject the response before this executor could inspect
         * it.
         */
        tools: [
          webSearchTool({
            searchContextSize:
              "high",
          }),
        ],
      });

    try {
      const result =
        await run(
          prospectingAgent,
          request,
          {
            maxTurns:
              MAX_TURNS,
          }
        );

      const rawOutput =
        result.finalOutput;

      if (
        typeof rawOutput !==
          "string" ||
        !rawOutput.trim()
      ) {
        return {
          success: false,

          summary:
            "The prospecting agent completed without producing usable output.",

          errorMessage:
            "Prospecting agent returned no final textual output.",

          transientFailure: false,

          resultData: {
            prospecting_type:
              "web_prospecting",

            product: {
              id:
                authoritativeProductId,

              name:
                authoritativeProductName,
            },

            evidence_status:
              "empty_agent_output",

            attempted_at:
              new Date().toISOString(),
          },
        };
      }

      /* -------------------------------------------------------------------- */
      /* Local JSON validation                                                 */
      /* -------------------------------------------------------------------- */

      const structuredOutput =
        parseProspectingOutput(
          rawOutput
        );

      if (!structuredOutput) {
        return {
          success: false,

          summary:
            "The prospecting agent returned output that could not be validated as the required JSON structure.",

          errorMessage:
            "Invalid prospecting JSON output.",

          transientFailure: true,

          resultData: {
            prospecting_type:
              "web_prospecting",

            product: {
              id:
                authoritativeProductId,

              name:
                authoritativeProductName,
            },

            evidence_status:
              "invalid_agent_json_output",

            attempted_at:
              new Date().toISOString(),

            raw_output_preview:
              cleanText(
                rawOutput
              ).slice(
                0,
                2000
              ),
          },
        };
      }

      /* -------------------------------------------------------------------- */
      /* Candidate normalization                                               */
      /* -------------------------------------------------------------------- */

      const candidates =
        structuredOutput
          .prospects
          .map(
            normalizeCandidate
          )
          .filter(
            (
              candidate
            ): candidate is ProspectCandidate =>
              candidate !== null
          )
          .slice(
            0,
            MAX_PROSPECTS_PER_ROUND
          );

      /* -------------------------------------------------------------------- */
      /* Persistence                                                           */
      /* -------------------------------------------------------------------- */

      const persisted:
        Prospect[] = [];

      const duplicates:
        string[] = [];

      const rejected:
        string[] = [];

      for (
        const candidate of
          candidates
      ) {
        if (
          isDuplicateProspect(
            existing,
            candidate,
            authoritativeProductId
          )
        ) {
          duplicates.push(
            candidate.name
          );

          continue;
        }

        try {
          const prospect =
            await createProspect({
              user_id:
                parent.user_id,

              source_task_id:
                parent.id,

              name:
                candidate.name,

              organization:
                candidate.organization,

              role:
                candidate.role,

              /**
               * Email is now deliberately passed through to the persistence
               * layer.
               */
              email:
                candidate.email,

              prospect_type:
                candidate.prospect_type as
                  ProspectType,

              qualification_status:
                candidate.qualification_status as
                  | "candidate"
                  | "qualified"
                  | "unqualified"
                  | "needs_review",

              website:
                candidate.website,

              public_profile_url:
                candidate.public_profile_url,

              /**
               * NEVER use a product ID supplied by the model.
               */
              product_id:
                authoritativeProductId,

              fit_reason:
                candidate.fit_reason,

              opportunity_signal:
                candidate.opportunity_signal,

              evidence:
                candidate.evidence,

              confidence:
                candidate.confidence,

              unknowns:
                candidate.unknowns,
            });

          persisted.push(
            prospect
          );

          /**
           * Add newly persisted records to the in-memory duplicate set so two
           * identical candidates returned in the same model response cannot
           * both be persisted.
           */
          existing.push(
            prospect
          );
        } catch {
          rejected.push(
            candidate.name
          );
        }
      }

      const evidenceStatus =
        persisted.length > 0
          ? "source_backed_contactable_prospects_persisted"
          : candidates.length > 0
            ? "contactable_candidates_found_but_none_persisted"
            : "no_valid_contactable_candidates_found";

      return {
        success:
          persisted.length > 0 ||
          candidates.length === 0,

        summary:
          persisted.length > 0
            ? `Identified and persisted ${persisted.length} contactable prospect${
                persisted.length ===
                1
                  ? ""
                  : "s"
              } for ${authoritativeProductName}.`
            : candidates.length === 0
              ? `No evidence-backed contactable prospects were identified for ${authoritativeProductName}.`
              : "Prospecting produced candidates, but none could be persisted.",

        transientFailure:
          false,

        resultData: {
          prospecting_type:
            "web_prospecting",

          product: {
            id:
              authoritativeProductId,

            name:
              authoritativeProductName,
          },

          search_objective:
            structuredOutput.search_objective ||
            subtask.title,

          qualification_method:
            structuredOutput.qualification_method ||
            "Evidence-based public-web qualification with public-email contactability.",

          round:
            Number(roundNumber) ||
            null,

          total_rounds:
            Number(totalRounds) ||
            null,

          prospects_found:
            candidates.length,

          prospects_persisted:
            persisted.length,

          prospects_with_email:
            persisted.filter(
              (
                prospect
              ) =>
                Boolean(
                  prospect.email
                )
            ).length,

          /**
           * Because email is enforced before persistence, every persisted
           * prospect is contactable.
           */
          prospects_without_email:
            0,

          duplicates_skipped:
            duplicates.length,

          rejected:
            rejected.length,

          persisted_prospect_ids:
            persisted.map(
              (
                prospect
              ) =>
                prospect.id
            ),

          duplicate_prospects:
            duplicates,

          rejected_candidates:
            rejected,

          evidence_gaps:
            structuredOutput.evidence_gaps ??
            [],

          evidence_status:
            evidenceStatus,

          source_method:
            "OpenAI Agents SDK hosted web search",

          model:
            MODEL,

          max_prospects_per_round:
            MAX_PROSPECTS_PER_ROUND,

          completed_at:
            new Date().toISOString(),
        },
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown prospecting execution error.";

      return {
        success: false,

        summary:
          `Web prospecting failed: ${message}`,

        errorMessage:
          message,

        /**
         * External/model/search failures remain transient so the task engine
         * can retry them.
         */
        transientFailure:
          true,

        resultData: {
          prospecting_type:
            "web_prospecting",

          product: {
            id:
              authoritativeProductId,

            name:
              authoritativeProductName,
          },

          evidence_status:
            "prospecting_failed",

          attempted_at:
            new Date().toISOString(),
        },
      };
    }
  },
};