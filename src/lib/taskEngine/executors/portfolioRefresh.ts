/**
 * Innocent Labs Portfolio Refresh Executor
 * -----------------------------------------
 *
 * Milestone 3D - Live portfolio awareness.
 *
 * Visits the public Innocent Labs marketplace and reconciles observable
 * portfolio entries with the local product registry.
 *
 * The executor is deliberately conservative.
 *
 * It may:
 * - fetch the public Innocent Labs marketplace;
 * - inspect publicly visible HTML;
 * - identify product-like links;
 * - validate discovered URLs;
 * - persist newly observed portfolio products;
 * - update portfolio identity fields for existing products.
 *
 * It does NOT:
 * - contact anyone;
 * - submit forms;
 * - create accounts;
 * - purchase anything;
 * - send messages;
 * - infer commercial performance;
 * - infer customer demand;
 * - infer buying intent;
 * - overwrite deeper product intelligence.
 */

import type { AgentTask } from "@/lib/types";

import type { StepResult, TaskExecutor } from "../types";

import {
  isValidPortfolioUrl,
  listProducts,
  upsertDiscoveredPortfolioProduct,
} from "@/lib/models/products";

const PORTFOLIO_URL = "https://innocent.co.ke";

const FETCH_TIMEOUT_MS = 15_000;

const MAX_HTML_CHARS = 2_000_000;

/**
 * Safety cap for the number of product candidates persisted during one
 * refresh.
 */
const MAX_PRODUCTS_PER_REFRESH = 100;

const MAX_NAME_LENGTH = 200;

const MAX_DESCRIPTION_LENGTH = 1_000;

/**
 * --------------------------------------------------------------------------
 * Utility functions
 * --------------------------------------------------------------------------
 */

function nowIso(): string {
  return new Date().toISOString();
}

function clean(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

/**
 * Normalizes a URL so equivalent URLs do not become separate discoveries.
 */
function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);

    url.hash = "";

    if (
      url.pathname.length > 1 &&
      url.pathname.endsWith("/")
    ) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return value.trim();
  }
}

/**
 * Returns true when the URL points back to the Innocent Labs marketplace.
 */
function isPortfolioHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const portfolioHost = new URL(PORTFOLIO_URL).hostname;

    return (
      parsed.hostname === portfolioHost ||
      parsed.hostname === `www.${portfolioHost}`
    );
  } catch {
    return false;
  }
}

/**
 * Navigation and utility labels that should never become products.
 */
const REJECTED_NAMES = new Set([
  "products",
  "product",
  "solutions",
  "solution",
  "services",
  "service",
  "learn more",
  "get started",
  "start now",
  "read more",
  "view all",
  "view all featured",
  "view products",
  "our products",
  "browse",
  "browse all",
  "community",
  "pricing",
  "shop",
  "buy now",
  "contact",
  "contact us",
  "about",
  "about us",
  "home",
  "blog",
  "login",
  "log in",
  "sign in",
  "sign up",
  "register",
  "privacy policy",
  "terms",
  "list your solution",
  "help me figure it out",
]);

/**
 * Navigation/category URL patterns that should never become products.
 */
const REJECTED_PATHS = [
  "/contact",
  "/login",
  "/log-in",
  "/signin",
  "/sign-in",
  "/signup",
  "/sign-up",
  "/register",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/terms-of-service",
  "/about",
  "/about-us",
  "/blog",
  "/category/",
  "/categories/",
  "/tag/",
  "/author/",
  "/feed",
  "/wp-admin",
  "/wp-login.php",
  "/cart",
  "/checkout",
  "/my-account",
  "/community",
  "/pricing",
  "/browse",
  "/solutions",
  "/services",
];

/**
 * Words that commonly indicate a link is informational/navigation rather
 * than a product destination.
 */
const REJECTED_TEXT_PATTERNS = [
  /\bcontact\b/i,
  /\blog\s*in\b/i,
  /\bsign\s*in\b/i,
  /\bsign\s*up\b/i,
  /\bprivacy\b/i,
  /\bterms\b/i,
  /\babout\s+us\b/i,
  /\bhome\b/i,
  /\bblog\b/i,
  /\bmenu\b/i,
  /\bsearch\b/i,
  /\bnext\b/i,
  /\bprevious\b/i,
  /\bbrowse\b/i,
  /\bview\s+all\b/i,
  /\blist\s+your\s+solution\b/i,
  /\bhelp\s+me\s+figure\s+it\s+out\b/i,
];

/**
 * Words/phrases that indicate the link is likely a marketplace category
 * rather than an individual product.
 */
const CATEGORY_PATTERNS = [
  /\bmake\s+more\s+money\b/i,
  /\bstart\s+a\s+business\b/i,
  /\bget\s+more\s+customers\b/i,
  /\buse\s+ai\b/i,
  /\blearn\s+a\s+skill\b/i,
  /\bbuild\s+something\b/i,
  /\bcreate\s+something\b/i,
  /\bsolve\s+a\s+personal\s+need\b/i,
  /\bstart\s+earning\s+online\b/i,
  /\bneed\s+more\s+customers\b/i,
  /\blearn\s+ai\b/i,
  /\bprofessional\s+online\s+presence\b/i,
  /\bpreserve\s+my\s+family\b/i,
];

/**
 * Some URLs are clearly assets rather than product pages.
 */
const REJECTED_FILE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".css",
  ".js",
  ".pdf",
  ".zip",
  ".xml",
  ".txt",
];

/**
 * Product links on the marketplace are normally either:
 *
 * 1. external links to the actual product; or
 * 2. internal links whose destination looks like a genuine product page.
 *
 * Internal utility/navigation links are deliberately excluded unless their
 * URL has a strong product-page signal.
 */
const PRODUCT_PATH_PATTERNS = [
  /^\/product\/[^/]+/i,
  /^\/products\/[^/]+/i,
  /^\/solution\/[^/]+/i,
  /^\/solutions\/[^/]+/i,
];

/**
 * Returns true when an internal URL has a strong product-page shape.
 */
function isStrongInternalProductUrl(
  url: string
): boolean {
  try {
    const parsed = new URL(url);

    if (!isPortfolioHost(url)) {
      return false;
    }

    const pathname = parsed.pathname;

    return PRODUCT_PATH_PATTERNS.some(
      (pattern) => pattern.test(pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Determines whether the visible link text looks like a real product name.
 *
 * This deliberately rejects sentence-like marketplace copy. Product names
 * can still contain punctuation, emoji and multiple words.
 */
function looksLikeProductName(
  text: string
): boolean {
  const normalized = clean(text);

  if (!normalized) {
    return false;
  }

  if (normalized.length < 2) {
    return false;
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    return false;
  }

  const lower = normalized.toLowerCase();

  if (REJECTED_NAMES.has(lower)) {
    return false;
  }

  if (
    REJECTED_TEXT_PATTERNS.some(
      (pattern) => pattern.test(normalized)
    )
  ) {
    return false;
  }

  if (
    CATEGORY_PATTERNS.some(
      (pattern) => pattern.test(normalized)
    )
  ) {
    return false;
  }

  /**
   * Marketplace calls-to-action and descriptive sentences frequently contain
   * these markers. A genuine product title may contain punctuation, but a
   * long sentence with sentence-ending punctuation is much less likely to
   * be a product name.
   */
  if (
    normalized.length > 90 &&
    /[.!?]\s/.test(normalized)
  ) {
    return false;
  }

  /**
   * These are strong indicators that the text is page copy rather than a
   * product title.
   */
  if (
    /\b(find|explore|discover|need|want|i want|i need)\b/i.test(
      normalized
    ) &&
    normalized.length > 45
  ) {
    return false;
  }

  return true;
}

/**
 * Determines whether a link is plausibly an individual product destination.
 *
 * External links are allowed because the Innocent Labs marketplace may list
 * products hosted on their own domains.
 *
 * Internal links require a strong product URL shape.
 */
function isLikelyProductLink(
  text: string,
  href: string
): boolean {
  const normalizedText = clean(text);

  if (!looksLikeProductName(normalizedText)) {
    return false;
  }

  let parsed: URL;

  try {
    parsed = new URL(href);
  } catch {
    return false;
  }

  const pathname = parsed.pathname.toLowerCase();

  if (
    REJECTED_PATHS.some(
      (path) =>
        pathname === path ||
        pathname.startsWith(path)
    )
  ) {
    return false;
  }

  if (
    REJECTED_FILE_EXTENSIONS.some(
      (extension) =>
        pathname.endsWith(extension)
    )
  ) {
    return false;
  }

  /**
   * A bare marketplace root is never a product.
   */
  if (
    isPortfolioHost(href) &&
    pathname === "/"
  ) {
    return false;
  }

  /**
   * Internal marketplace links are only accepted when their URL strongly
   * resembles an individual product destination.
   */
  if (isPortfolioHost(href)) {
    return isStrongInternalProductUrl(href);
  }

  /**
   * External URLs are potential product destinations. The product-name
   * checks above provide the primary conservative filter.
   */
  return true;
}

/**
 * --------------------------------------------------------------------------
 * HTML extraction
 * --------------------------------------------------------------------------
 */

/**
 * Extracts visible anchor elements from the HTML.
 *
 * This remains intentionally lightweight and dependency-free.
 */
function extractLinks(
  html: string
): Array<{
  text: string;
  href: string;
  context: string;
}> {
  const links: Array<{
    text: string;
    href: string;
    context: string;
  }> = [];

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    if (
      links.length >=
      MAX_PRODUCTS_PER_REFRESH * 5
    ) {
      break;
    }

    const rawHref = clean(match[1]);
    const rawText = stripHtml(match[2]);

    const text = clean(rawText).slice(
      0,
      MAX_NAME_LENGTH
    );

    if (!rawHref || !text) {
      continue;
    }

    let href: string;

    try {
      href = normalizeUrl(
        new URL(
          rawHref,
          PORTFOLIO_URL
        ).toString()
      );
    } catch {
      continue;
    }

    if (!isValidPortfolioUrl(href)) {
      continue;
    }

    if (!isLikelyProductLink(text, href)) {
      continue;
    }

    /**
     * Capture a modest amount of surrounding HTML. This gives the
     * description extractor a chance to find useful visible card text
     * without treating the surrounding content as authoritative intelligence.
     */
    const matchIndex =
      match.index ?? -1;

    const contextStart = Math.max(
      0,
      matchIndex - 1_500
    );

    const contextEnd = Math.min(
      html.length,
      matchIndex +
        match[0].length +
        1_500
    );

    links.push({
      text,
      href,
      context: html.slice(
        contextStart,
        contextEnd
      ),
    });
  }

  return links;
}

/**
 * Attempts to obtain a concise description from the immediate visible
 * context surrounding a product link.
 *
 * This remains weak evidence and is stored only as the product description.
 */
function inferDescriptionFromContext(
  context: string,
  anchorText: string
): string | undefined {
  const visible = clean(
    stripHtml(context)
  );

  if (!visible) {
    return undefined;
  }

  const escapedName =
    anchorText.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const withoutName =
    visible
      .replace(
        new RegExp(
          escapedName,
          "gi"
        ),
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

  if (
    !withoutName ||
    withoutName.length < 10
  ) {
    return undefined;
  }

  /**
   * Avoid accidentally persisting huge blocks of navigation or page text.
   */
  return withoutName
    .slice(0, MAX_DESCRIPTION_LENGTH)
    .trim();
}

/**
 * Normalizes a discovered product name.
 */
function normalizeProductName(
  value: string
): string | null {
  const name = clean(value)
    .replace(/[|]/g, " ")
    .replace(/→/g, "")
    .replace(/»/g, "")
    .trim();

  if (!looksLikeProductName(name)) {
    return null;
  }

  return name.slice(
    0,
    MAX_NAME_LENGTH
  );
}

/**
 * --------------------------------------------------------------------------
 * Product discovery
 * --------------------------------------------------------------------------
 */

/**
 * Extracts product-like entries from the marketplace HTML.
 */
function extractDiscoveredProducts(
  html: string
): Array<{
  name: string;
  url: string;
  description?: string;
}> {
  const links = extractLinks(html);

  const discoveredByName =
    new Map<
      string,
      {
        name: string;
        url: string;
        description?: string;
      }
    >();

  const discoveredByUrl =
    new Set<string>();

  for (const link of links) {
    const name =
      normalizeProductName(
        link.text
      );

    if (!name) {
      continue;
    }

    const url =
      normalizeUrl(link.href);

    if (
      discoveredByUrl.has(url)
    ) {
      continue;
    }

    const key =
      name.toLowerCase();

    /**
     * If several links have the same product name, retain the first
     * observation rather than creating duplicates.
     */
    if (
      discoveredByName.has(key)
    ) {
      continue;
    }

    discoveredByName.set(key, {
      name,
      url,
      description:
        inferDescriptionFromContext(
          link.context,
          link.text
        ),
    });

    discoveredByUrl.add(url);

    if (
      discoveredByName.size >=
      MAX_PRODUCTS_PER_REFRESH
    ) {
      break;
    }
  }

  return Array.from(
    discoveredByName.values()
  );
}

/**
 * --------------------------------------------------------------------------
 * Executor
 * --------------------------------------------------------------------------
 */

export const portfolioRefreshExecutor:
  TaskExecutor = {
    taskType:
      "portfolio_refresh",

    async runTask(
      task: AgentTask
    ): Promise<StepResult> {
      /**
       * The task parameter is intentionally retained because the executor
       * conforms to the existing TaskExecutor contract.
       */
      void task;

      const startedAt =
        nowIso();

      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () =>
            controller.abort(),
          FETCH_TIMEOUT_MS
        );

      try {
        const response =
          await fetch(
            PORTFOLIO_URL,
            {
              method: "GET",
              headers: {
                "User-Agent":
                  "Innocent-Intelligence-Portfolio-Refresh/1.0",
                Accept:
                  "text/html,application/xhtml+xml",
              },
              redirect: "follow",
              signal:
                controller.signal,
            }
          );

        const contentType =
          response.headers.get(
            "content-type"
          );

        const html =
          (
            await response.text()
          ).slice(
            0,
            MAX_HTML_CHARS
          );

        if (!response.ok) {
          return {
            success: false,

            summary:
              `Could not refresh the Innocent Labs portfolio because ${PORTFOLIO_URL} returned HTTP ${response.status}.`,

            errorMessage:
              `Portfolio website returned HTTP ${response.status}.`,

            transientFailure:
              response.status >= 500 ||
              response.status === 429,

            resultData: {
              refresh_type:
                "portfolio_refresh",

              source_url:
                PORTFOLIO_URL,

              http_status:
                response.status,

              content_type:
                contentType,

              observed_at:
                startedAt,

              evidence_status:
                "portfolio_refresh_failed",
            },
          };
        }

        if (
          contentType &&
          !contentType
            .toLowerCase()
            .includes("text/html")
        ) {
          return {
            success: false,

            summary:
              `Portfolio refresh could not interpret ${PORTFOLIO_URL} because the response was not HTML.`,

            errorMessage:
              `Unexpected portfolio content type: ${contentType}.`,

            transientFailure:
              false,

            resultData: {
              refresh_type:
                "portfolio_refresh",

              source_url:
                PORTFOLIO_URL,

              http_status:
                response.status,

              content_type:
                contentType,

              observed_at:
                startedAt,

              evidence_status:
                "unexpected_content_type",
            },
          };
        }

        const discovered =
          extractDiscoveredProducts(
            html
          );

        const before =
          listProducts();

        const existingNames =
          new Set(
            before.map(
              (product) =>
                product.name
                  .trim()
                  .toLowerCase()
            )
          );

        const existingUrls =
          new Set(
            before
              .map(
                (product) =>
                  product.url
                    ?.trim()
                    .toLowerCase()
              )
              .filter(
                (
                  url
                ): url is string =>
                  Boolean(url)
              )
          );

        const persisted: string[] = [];

        const newlyDiscovered: string[] = [];

        const rejected: string[] = [];

        for (
          const candidate of discovered
        ) {
          try {
            const normalizedCandidateUrl =
              normalizeUrl(
                candidate.url
              );

            const product =
              upsertDiscoveredPortfolioProduct(
                {
                  name:
                    candidate.name,

                  url:
                    normalizedCandidateUrl,

                  description:
                    candidate.description,

                  status:
                    "active",

                  notes:
                    "Discovered from the public Innocent Labs portfolio refresh.",
                }
              );

            persisted.push(
              product.name
            );

            const normalizedProductName =
              product.name
                .trim()
                .toLowerCase();

            const alreadyKnown =
              existingNames.has(
                normalizedProductName
              ) ||
              existingUrls.has(
                normalizedCandidateUrl
                  .toLowerCase()
              );

            if (!alreadyKnown) {
              newlyDiscovered.push(
                product.name
              );
            }
          } catch {
            rejected.push(
              candidate.name
            );
          }
        }

        const after =
          listProducts();

        const summary =
          newlyDiscovered.length > 0
            ? `Portfolio refresh completed. Observed ${discovered.length} product-like public entries and discovered ${newlyDiscovered.length} new Innocent Labs product record${newlyDiscovered.length === 1 ? "" : "s"}.`
            : `Portfolio refresh completed. No new Innocent Labs products were discovered.`;

        return {
          success: true,

          summary,

          transientFailure:
            false,

          resultData: {
            refresh_type:
              "portfolio_refresh",

            source_url:
              PORTFOLIO_URL,

            observed_at:
              startedAt,

            refreshed_at:
              nowIso(),

            http_status:
              response.status,

            content_type:
              contentType,

            html_chars_observed:
              html.length,

            products_before:
              before.length,

            products_after:
              after.length,

            product_links_observed:
              discovered.length,

            products_persisted:
              persisted.length,

            new_products_discovered:
              newlyDiscovered.length,

            discovered_products:
              newlyDiscovered,

            persisted_products:
              persisted,

            rejected_candidates:
              rejected,

            evidence_status:
              "direct_public_portfolio_observation",

            important_note:
              "Portfolio discovery establishes that a product-like public entry was observed on the Innocent Labs marketplace. It does not establish customer demand, revenue, buying intent, or commercial performance.",
          },
        };
      } catch (error) {
        const isAbort =
          error instanceof Error &&
          error.name ===
            "AbortError";

        const message =
          isAbort
            ? `No response from ${PORTFOLIO_URL} within ${FETCH_TIMEOUT_MS / 1000} seconds.`
            : error instanceof Error
              ? error.message
              : "Unknown portfolio refresh error.";

        return {
          success: false,

          summary:
            `Portfolio refresh failed: ${message}`,

          errorMessage:
            message,

          transientFailure:
            true,

          resultData: {
            refresh_type:
              "portfolio_refresh",

            source_url:
              PORTFOLIO_URL,

            observed_at:
              startedAt,

            evidence_status:
              "portfolio_refresh_failed",
          },
        };
      } finally {
        clearTimeout(
          timeout
        );
      }
    },
  };
