import { stateAbbrToSlug, countryCodeToSlug, COUNTRY_SLUG_TO_CODE } from './state-names';

export interface SlugParts {
  postalCode: string;
  countryCode: string;
}

/**
 * Build a SEO-friendly URL path from location data.
 * Examples:
 *   buildLocationSlug('29209', 'Columbia', 'SC', 'us') → '/united-states-29209-columbia-south-carolina'
 *   buildLocationSlug('M5V 3L9', 'Toronto', 'ON', 'ca') → '/canada-m5v3l9-toronto-ontario'
 */
export function buildLocationSlug(postalCode: string, city: string, state: string, countryCode: string = 'us'): string {
  const countrySlug = countryCodeToSlug(countryCode);
  const cleanPostal = postalCode.replace(/\s+/g, '').toLowerCase();
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const stateSlug = state.length <= 3
    ? stateAbbrToSlug(state)
    : state.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `/${countrySlug}-${cleanPostal}-${citySlug}-${stateSlug}`;
}

/**
 * Parse a slug to extract postal code and country.
 * The postal code is the source of truth; city/state in URL are for SEO only.
 */
export function parseLocationSlug(slug: string): SlugParts | null {
  // Try known country prefixes
  for (const [countrySlug, countryCode] of Object.entries(COUNTRY_SLUG_TO_CODE)) {
    if (!slug.startsWith(countrySlug + '-')) continue;
    const rest = slug.slice(countrySlug.length + 1); // e.g., "29209-columbia-south-carolina"

    if (countryCode === 'us') {
      // US: 5-digit zip
      const match = rest.match(/^(\d{5})-/);
      if (match) return { postalCode: match[1], countryCode: 'us' };
    } else if (countryCode === 'ca') {
      // Canada: 6 alphanumeric (A1A1A1 in URL, originally A1A 1A1)
      const match = rest.match(/^([a-z0-9]{6})-/i);
      if (match) return { postalCode: match[1].toUpperCase(), countryCode: 'ca' };
    } else {
      // Generic: grab everything before the next hyphen-letter sequence that looks like a city
      const match = rest.match(/^([a-z0-9]+)-/i);
      if (match) return { postalCode: match[1], countryCode };
    }
  }
  return null;
}

/**
 * Forward-geocode a postal code via Nominatim.
 */
export async function geocodePostalCode(postalCode: string, countryCode: string = 'us'): Promise<{
  lat: number;
  lon: number;
  city: string;
  state: string;
  zip: string;
  countryCode: string;
} | null> {
  try {
    const cleanPostal = postalCode.replace(/\s+/g, '');
    const url = `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(cleanPostal)}&country=${countryCode}&addressdetails=1&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SportsCast/1.0 (sports weather dashboard)' },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (results.length === 0) return null;

    const r = results[0];
    const addr = r.address || {};
    const city = addr.city || addr.town || addr.village || addr.hamlet || '';
    const state = addr.state || '';

    return {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      city,
      state,
      zip: addr.postcode || cleanPostal,
      countryCode,
    };
  } catch {
    return null;
  }
}
