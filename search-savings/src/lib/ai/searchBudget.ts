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
 * A prospecting run stops starting new rounds once this many new
 * prospects have been saved in the run. Rounds used to run all 4 every
 * time, searching for more even after earlier rounds had found plenty.
 */
export const PROSPECTS_TARGET_PER_RUN = 20;
