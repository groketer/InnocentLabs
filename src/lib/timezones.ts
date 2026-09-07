/**
 * MILESTONE 3R — international-timezone-aware sending.
 *
 * Rather than one fixed sending window (which would just be the
 * sender's own business hours, imposed on everyone regardless of where
 * they actually are), this determines whether it's currently a
 * reasonable time to email a SPECIFIC prospect based on THEIR country.
 * A prospect in Nairobi and a prospect in Toronto shouldn't be emailed
 * at the same wall-clock moment just because both sends happen to fire
 * from the same account.
 *
 * Deliberately approximate: a country-level UTC offset, not a precise
 * per-city timezone lookup, and not DST-aware (DST shifts by ~1 hour,
 * which doesn't meaningfully change whether it's "business hours" for
 * this purpose). Good enough to avoid emailing someone in the middle of
 * their night — the actual goal — without needing a full timezone
 * database dependency for a fairly coarse business-hours check.
 */

// UTC offset in hours for a country. Countries spanning multiple
// timezones use their most populous/business-relevant zone. Not
// exhaustive — covers the countries most likely to come up given this
// system's actual usage — with a sensible fallback for anything missing.
const COUNTRY_UTC_OFFSET: Record<string, number> = {
  // Eastern Africa
  kenya: 3,
  tanzania: 3,
  uganda: 3,
  ethiopia: 3,
  rwanda: 2,
  burundi: 2,
  somalia: 3,
  "south sudan": 2,
  djibouti: 3,
  eritrea: 3,

  // Southern / Western / Northern Africa
  "south africa": 2,
  nigeria: 1,
  ghana: 0,
  egypt: 2,
  morocco: 1,
  "ivory coast": 0,
  senegal: 0,
  zambia: 2,
  zimbabwe: 2,
  botswana: 2,
  namibia: 2,

  // Europe
  "united kingdom": 0,
  ireland: 0,
  portugal: 0,
  france: 1,
  germany: 1,
  spain: 1,
  italy: 1,
  netherlands: 1,
  belgium: 1,
  switzerland: 1,
  poland: 1,
  sweden: 1,
  norway: 1,
  denmark: 1,
  finland: 2,
  greece: 2,
  romania: 2,
  turkey: 3,

  // Middle East
  "united arab emirates": 4,
  "saudi arabia": 3,
  qatar: 3,
  israel: 2,

  // Asia
  india: 5.5,
  pakistan: 5,
  bangladesh: 6,
  china: 8,
  "hong kong": 8,
  singapore: 8,
  malaysia: 8,
  philippines: 8,
  indonesia: 7,
  vietnam: 7,
  thailand: 7,
  japan: 9,
  "south korea": 9,

  // Oceania
  australia: 10,
  "new zealand": 12,

  // Americas
  "united states": -5, // Eastern — the single most common US business timezone
  canada: -5,
  mexico: -6,
  brazil: -3,
  argentina: -3,
  colombia: -5,
  chile: -4,
};

export function normalizeCountryName(country: string): string {
  return country.trim().toLowerCase();
}

/**
 * Returns the UTC offset for a country, or null if unknown. Null should
 * be treated as "no information" — see isBusinessHoursFor()'s fallback
 * behavior for what to do in that case.
 */
export function getUtcOffsetForCountry(country: string | null | undefined): number | null {
  if (!country) return null;
  const normalized = normalizeCountryName(country);
  return COUNTRY_UTC_OFFSET[normalized] ?? null;
}

const BUSINESS_HOUR_START = 8; // 8am
const BUSINESS_HOUR_END = 18; // 6pm

/**
 * Whether it's currently a reasonable time to email someone in the given
 * country. When the country is unknown, this is deliberately permissive
 * (returns true) — an unknown location should never permanently block a
 * send; it just means this specific safeguard has nothing to check
 * against and falls back to "don't block."
 */
export function isBusinessHoursFor(
  country: string | null | undefined,
  now: Date = new Date()
): boolean {
  const offset = getUtcOffsetForCountry(country);
  if (offset === null) return true;

  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
  let localHour = utcHour + offset;
  localHour = ((localHour % 24) + 24) % 24; // normalize into [0, 24)

  return localHour >= BUSINESS_HOUR_START && localHour < BUSINESS_HOUR_END;
}
