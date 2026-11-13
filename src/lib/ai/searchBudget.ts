/**
 * WEB SEARCH BUDGETS — the main lever on AI cost.
 *
 * Every web search is billed on its own, on top of tokens:
 *   - OpenAI (gpt-4.1-mini): $10 per 1,000 searches + a fixed 8,000-token
 *     block per search ≈ 1.3¢ per search.
 *   - Claude: $10 per 1,000 searches + the result tokens ≈ 1¢ per search.
 * The models themselves are cheap by comparison, so how many searches a
 * job runs decides most of the bill.
 *
 * Each value is the most searches the model may run in ONE step (one
 * model response). A job's worst case is that value × its maxTurns.
 * Raise a value if a job starts coming back with thinner results.
 */
export const SEARCH_BUDGET = {
  /** One prospecting round (up to 4 rounds per run, several runs a day). */
  prospectingRound: 4,
  /** Finding one candidate's public email address. */
  contactDiscovery: 2,
  /** Daily refresh of the live Innocent Labs portfolio. */
  portfolioRefresh: 3,
  /** Deep qualification of one prospect. */
  deepQualification: 3,
  /** Writing an outreach email, used only when the product's stored details are thin. */
  emailCompose: 2,
  /** A research task someone asked for explicitly. */
  research: 5,
  /** Building a product brief. */
  productBrief: 5,
  /** One chat reply. */
  chat: 3,
} as const;

/** Turns allowed for the contact-email search (it previously used the SDK default of 10). */
export const CONTACT_DISCOVERY_MAX_TURNS = 3;

/**
 * GOAL OF EACH PROSPECTING RUN: keep going until this many new
 * prospects have been saved, then stop. Rounds after the target is met
 * finish at once without calling the AI.
 */
export const PROSPECTS_TARGET_PER_RUN = 10;

/**
 * Most rounds a run may use to reach the target. Each round searches a
 * different angle (see roundSearchAngle in prospecting.ts), so later
 * rounds find different people rather than the same ones again. A run
 * that reaches the target early uses fewer rounds, and costs less.
 */
export const MAX_PROSPECTING_ROUNDS = 8;

/** Candidates each round asks the search agent for. Many are dropped later (no verified email, not a fit, duplicates), so this is above what a round usually saves. */
export const CANDIDATES_PER_ROUND = 12;
