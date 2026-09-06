/**
 * MILESTONE 3J — Inbound email.
 *
 * Heuristic bounce detection. Real-world bounce messages vary a lot —
 * some are properly formatted RFC 3464 delivery status notifications,
 * many aren't — so this layers several signals rather than depending on
 * any single one:
 *
 * 1. Sender/subject patterns that essentially every mail system uses for
 *    bounces (mailer-daemon, postmaster, "undelivered", etc.).
 * 2. A "Final-Recipient:"/"Original-Recipient:" line, which properly
 *    formatted DSN bounces include — the most reliable way to extract
 *    exactly which address failed.
 * 3. Falling back to scanning the body for any email address that
 *    matches one of the caller's own known prospects, when the DSN
 *    fields aren't present.
 */

const BOUNCE_SENDER_PATTERN =
  /mailer-daemon|postmaster|mail delivery|mail administrator|delivery status notification/i;

const BOUNCE_SUBJECT_PATTERN =
  /undeliver|delivery status|delivery failure|returned mail|failure notice|delivery has failed|could not be delivered|non-delivery/i;

export function looksLikeBounce(input: {
  fromAddress: string;
  subject: string;
  text: string;
}): boolean {
  if (BOUNCE_SENDER_PATTERN.test(input.fromAddress)) return true;
  if (BOUNCE_SUBJECT_PATTERN.test(input.subject)) return true;
  // A proper DSN body contains this field regardless of sender/subject wording.
  if (/final-recipient\s*:/i.test(input.text)) return true;
  return false;
}

/**
 * Extracts the address that actually bounced, using the DSN
 * Final-Recipient/Original-Recipient field when present, or by scanning
 * the body for the first address that matches a known prospect otherwise.
 */
export function extractBouncedAddress(
  bodyText: string,
  knownProspectEmails: Set<string>
): string | null {
  const dsnMatch = bodyText.match(
    /(?:final|original)-recipient\s*:\s*(?:rfc822;)?\s*([^\s<>]+@[^\s<>]+)/i
  );

  if (dsnMatch) {
    const candidate = dsnMatch[1].toLowerCase().trim();
    if (knownProspectEmails.has(candidate)) {
      return candidate;
    }
  }

  // Fall back to scanning the whole body for any address we recognize —
  // real-world bounce formats vary too much to rely on DSN fields alone.
  const allAddresses = bodyText.match(/[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/g) ?? [];

  for (const raw of allAddresses) {
    const candidate = raw.toLowerCase().replace(/[.,;:]+$/, "").trim();
    if (knownProspectEmails.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
