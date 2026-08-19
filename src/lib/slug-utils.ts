import { stateAbbrToSlug, countryCodeToSlug, COUNTRY_SLUG_TO_CODE } from './state-names';

export interface SlugParts {
  postalCode: string;
  countryCode: string;
}

/**
 * Build a SEO-friendly URL path from location data.
 * Format: /{country}-{state}-{city}-{zip}
 * Examples:
 *   buildLocationSlug('29209', 'Columbia', 'SC', 'us') → '/united-states-south-carolina-columbia-29209'
 *   buildLocationSlug('M5V 3L9', 'Toronto', 'ON', 'ca') → '/canada-ontario-toronto-m5v3l9'
 */
export function buildLocationSlug(postalCode: string, city: string, state: string, countryCode: string = 'us'): string {
  const countrySlug = countryCodeToSlug(countryCode);
  const cleanPostal = postalCode.replace(/\s+/g, '').toLowerCase();
  // Guard: if city looks like a zip code (all digits), don't use it
  let cityClean = city;
  if (/^\d+$/.test(cityClean.trim())) cityClean = '';
  const citySlug = cityClean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const stateSlug = state.length <= 3
    ? stateAbbrToSlug(state)
    : state.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  // Build: country-state-city-zip (omit city segment if empty)
  if (citySlug) {
    return `/${countrySlug}-${stateSlug}-${citySlug}-${cleanPostal}`;
  }
  return `/${countrySlug}-${stateSlug}-${cleanPostal}`;
}

/**
 * Parse a slug to extract postal code and country.
 * The postal code is the source of truth; city/state in URL are for SEO only.
 * Supports both new format (zip at end) and legacy format (zip after country).
 */
export function parseLocationSlug(slug: string): SlugParts | null {
  // Try known country prefixes
  for (const [countrySlug, countryCode] of Object.entries(COUNTRY_SLUG_TO_CODE)) {
    if (!slug.startsWith(countrySlug + '-')) continue;
    const rest = slug.slice(countrySlug.length + 1);

    if (countryCode === 'us') {
      // New format: zip at end — e.g., "south-carolina-columbia-29209"
      const endMatch = rest.match(/-(\d{5})$/);
      if (endMatch) return { postalCode: endMatch[1], countryCode: 'us' };
      // Legacy format: zip at start — e.g., "29209-columbia-south-carolina"
      const startMatch = rest.match(/^(\d{5})-/);
      if (startMatch) return { postalCode: startMatch[1], countryCode: 'us' };
      // Bare zip: e.g., "south-carolina-29209" (no city)
      const bareMatch = rest.match(/(\d{5})$/);
      if (bareMatch) return { postalCode: bareMatch[1], countryCode: 'us' };
    } else if (countryCode === 'ca') {
      // New format: postal at end
      const endMatch = rest.match(/-([a-z0-9]{6})$/i);
      if (endMatch) return { postalCode: endMatch[1].toUpperCase(), countryCode: 'ca' };
      // Legacy format: postal at start
      const startMatch = rest.match(/^([a-z0-9]{6})-/i);
      if (startMatch) return { postalCode: startMatch[1].toUpperCase(), countryCode: 'ca' };
    } else {
      // Generic: grab last alphanumeric segment as postal
      const endMatch = rest.match(/-([a-z0-9]+)$/i);
      if (endMatch) return { postalCode: endMatch[1], countryCode };
      const startMatch = rest.match(/^([a-z0-9]+)-/i);
      if (startMatch) return { postalCode: startMatch[1], countryCode };
    }
  }
  return null;
}

/**
 * Forward-geocode a postal code.
 *
 * Step 188 — US zips are validated ONLY against the local
 * `us-zip-codes.json` dataset, which is authoritative: the site has a
 * page for every legitimate US ZIP, so a miss here means the ZIP is not
 * real, full stop. US requests NEVER fall through to Nominatim — that
 * fuzzy external geocoder was previously matching nonsense 5-digit
 * strings (99999, 88888) to a real-world place via partial/loose
 * address data, which handed out live HTTP 200s for fake ZIP-shaped
 * URLs. Confirmed live before this fix: 00001 and 55555 correctly
 * failed to geocode, but 99999 and 88888 both resolved through
 * Nominatim to *something*. That non-determinism is unacceptable for
 * "is this a real US ZIP" — the local dataset is the only source of
 * truth for that question now.
 *
 * Non-US postal codes have no local dataset in this app, so they still
 * use Nominatim (unchanged).
 *
 * Known consequence: a handful of real-world "unique" ZIPs missing from
 * the local dataset (e.g. Boston 02101-02107) now 404 instead of
 * resolving via Nominatim as they used to. This is an unverified
 * dataset gap, not a confirmed-correct exclusion — their current
 * validity was not established. See the investigation note on
 * `lookupZip` in `zip-lookup.ts` for why those
 * were not added back on inferred data.
 */
export async function geocodePostalCode(postalCode: string, countryCode: string = 'us'): Promise<{
  lat: number;
  lon: number;
  city: string;
  state: string;
  zip: string;
  countryCode: string;
} | null> {
  if (countryCode === 'us') {
    // Dynamic import keeps the 2.7MB JSON out of client bundles. A
    // miss (including an import failure) returns null directly — it
    // must NOT fall through to the Nominatim block below.
    try {
      const { lookupZip } = await import('./zip-lookup');
      return lookupZip(postalCode);
    } catch {
      return null;
    }
  }

  // Non-US: no authoritative local dataset, so Nominatim remains the
  // only option.
  try {
    const cleanPostal = postalCode.replace(/\s+/g, '');
    const url = `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(cleanPostal)}&country=${countryCode}&addressdetails=1&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WagerOnWeather/1.0 (sports weather dashboard)' },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (results.length === 0) return null;

    const r = results[0];
    const addr = r.address || {};
    let city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const state = addr.state || '';
    const lat = parseFloat(r.lat);
    const lon = parseFloat(r.lon);

    // If no city found (only county), reverse geocode at higher zoom to get city name
    if (!city && lat && lon) {
      try {
        const revUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
        const revRes = await fetch(revUrl, {
          headers: { 'User-Agent': 'WagerOnWeather/1.0 (sports weather dashboard)' },
        });
        if (revRes.ok) {
          const revData = await revRes.json();
          const revAddr = revData.address || {};
          city = revAddr.city || revAddr.town || revAddr.village || revAddr.hamlet || city;
        }
      } catch {}
    }

    return {
      lat,
      lon,
      city,
      state,
      zip: addr.postcode || cleanPostal,
      countryCode,
    };
  } catch {
    return null;
  }
}
