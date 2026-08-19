import zipData from '../data/us-zip-codes.json';
import { STATE_ABBR_TO_FULL } from './state-names';

interface ZipEntry {
  z: string;
  c: string;
  s: string;
  lat: number;
  lon: number;
}

// State abbreviation → full display name (e.g. "SC" → "South Carolina")
const STATE_DISPLAY: Record<string, string> = {};
for (const [abbr, slug] of Object.entries(STATE_ABBR_TO_FULL)) {
  STATE_DISPLAY[abbr] = slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Build lookup map once on module load
const zipMap = new Map<string, ZipEntry>();
for (const entry of zipData as ZipEntry[]) {
  zipMap.set(entry.z, entry);
}

export interface ZipLookupResult {
  lat: number;
  lon: number;
  city: string;
  state: string;
  zip: string;
  countryCode: string;
}

/** Great-circle distance in miles. */
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Find the nearest US zip code to a lat/lon. Used as a deterministic fallback
 * when reverseGeocode fails (e.g., Nominatim down or coords with no postcode).
 * Linear scan over ~40K entries — fast enough for SSR redirects.
 */
export function findNearestZip(lat: number, lon: number): ZipLookupResult | null {
  let best: ZipEntry | null = null;
  let bestDist = Infinity;
  // A degree of longitude is only cos(lat) as wide as a degree of latitude, so
  // raw squared degrees overweight east-west distance and can pick the wrong
  // neighbour. Scaling by cos(lat) keeps the comparison honest without paying
  // for a full haversine on every one of the ~40K entries.
  const lonScale = Math.cos((lat * Math.PI) / 180);
  for (const entry of zipData as ZipEntry[]) {
    const dLat = entry.lat - lat;
    const dLon = (entry.lon - lon) * lonScale;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  if (!best) return null;
  return {
    lat: best.lat,
    lon: best.lon,
    city: best.c,
    state: STATE_DISPLAY[best.s] || best.s,
    zip: best.z,
    countryCode: 'us',
  };
}

/**
 * Nearest US zip, but only when it is genuinely nearby.
 *
 * findNearestZip always returns something, so a user in London would resolve
 * to a zip in Maine and get a confidently wrong page. The radius guard exists
 * to catch that: off-continent and mid-ocean coords land hundreds of miles
 * from any zip and get rejected.
 *
 * What it deliberately does NOT do is enforce a border. Windsor, Ontario sits
 * 1.2 miles from Detroit's zip centroid and Tijuana 3.3 miles from San Ysidro,
 * so no radius can separate "near-border foreign" from "remote domestic" —
 * the worst legitimate US case measured (Yellowstone's interior) is 25 miles
 * out, ten times further than Windsor. A near-border visitor therefore gets
 * the nearest US zip. For a weather site that is usually the right answer
 * anyway, since Windsor and Detroit share the same weather.
 *
 * 50 miles covers every remote US case measured (Yellowstone 25.4, northern
 * Maine 17.1, Barrow 3.9) with room to spare.
 */
export function findNearestZipWithin(
  lat: number,
  lon: number,
  maxMiles: number = 50,
): ZipLookupResult | null {
  const nearest = findNearestZip(lat, lon);
  if (!nearest) return null;
  return haversineMiles(lat, lon, nearest.lat, nearest.lon) <= maxMiles ? nearest : null;
}

/**
 * Look up a US zip code from the local cache — the SOLE authority for
 * US ZIP validity (see `geocodePostalCode` in `slug-utils.ts`, which no
 * longer falls back to Nominatim for US codes). Returns null if not
 * found, full stop.
 *
 * Unverified dataset gap: these ZIPs are absent from the local
 * authoritative dataset available to the application. Their current
 * validity was not established during this work. Specifically:
 * 02101-02107 (Boston "unique"/administrative ZIPs — assigned to
 * specific large-volume mail recipients rather than a delivery area)
 * are absent from this dataset. Confirmed this is NOT a blanket "unique
 * ZIPs are excluded" rule — five other well-known unique ZIPs in other
 * cities (10118 Empire State Building, 20505 CIA HQ, 30301 Atlanta main
 * PO, 90209 Beverly Hills PO boxes, 94120 SF PO boxes) ARE present. The
 * source spreadsheet this dataset was generated from (`Weather muse/DBD
 * zip code master list.xlsx`, see `scripts/convert-zip-data.js`) is
 * gitignored and not present on disk, so whether 02101-02107 were
 * absent from the source entirely or dropped by the conversion script's
 * coordinate-validity filter could not be determined. Per this
 * project's data-authority rule — the local dataset decides validity,
 * no fuzzy/external lookup — these 7 codes were deliberately NOT added
 * back on inferred/remembered coordinates alone; that would reintroduce
 * unverified data through a different door. They currently 404 as an
 * unverified-gap consequence, not a confirmed-correct outcome.
 * Recovering the source file, or a deliberate one-time authoritative
 * USPS/Census lookup, would be a Phase 2 action if these specific codes
 * matter.
 */
export function lookupZip(postalCode: string): ZipLookupResult | null {
  const clean = postalCode.replace(/\s+/g, '').padStart(5, '0');
  const entry = zipMap.get(clean);
  if (!entry) return null;

  return {
    lat: entry.lat,
    lon: entry.lon,
    city: entry.c,
    state: STATE_DISPLAY[entry.s] || entry.s,
    zip: entry.z,
    countryCode: 'us',
  };
}

// Reverse lookup: full state name → abbreviation (for "Camden South Carolina" style queries)
const STATE_NAME_TO_ABBR: Record<string, string> = {};
for (const [abbr, slug] of Object.entries(STATE_ABBR_TO_FULL)) {
  const fullName = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').toLowerCase();
  STATE_NAME_TO_ABBR[fullName] = abbr;
}

/** Expand common US city name abbreviations so "St. Paul" matches "Saint Paul". */
const CITY_ABBREVS: [RegExp, string][] = [
  [/^st\.?\s/i, 'Saint '],
  [/^ft\.?\s/i, 'Fort '],
  [/^mt\.?\s/i, 'Mount '],
];

function expandAbbreviations(city: string): string {
  for (const [pattern, replacement] of CITY_ABBREVS) {
    if (pattern.test(city)) return city.replace(pattern, replacement);
  }
  return city;
}

/**
 * Parse a query like "Camden SC", "Camden, SC", or "Camden, South Carolina"
 * into { city, stateAbbr } if a state filter is detected.
 */
function parseStateFilter(query: string): { city: string; stateAbbr: string | null } {
  const q = query.trim();

  // "City, ST" or "City ST" with 2-letter abbreviation at the end
  const abbrMatch = q.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  if (abbrMatch) {
    const abbr = abbrMatch[2].toUpperCase();
    if (STATE_DISPLAY[abbr]) {
      return { city: abbrMatch[1].trim(), stateAbbr: abbr };
    }
  }

  // "City, State Name" or "City State Name" with full state name
  const commaIdx = q.indexOf(',');
  if (commaIdx > 0) {
    const statePart = q.slice(commaIdx + 1).trim().toLowerCase();
    const abbr = STATE_NAME_TO_ABBR[statePart];
    if (abbr) return { city: q.slice(0, commaIdx).trim(), stateAbbr: abbr };
  }

  // Try matching full state name at end (e.g. "Camden South Carolina")
  for (const [fullName, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    const displayName = fullName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (q.toLowerCase().endsWith(' ' + fullName) || q.endsWith(' ' + displayName)) {
      const city = q.slice(0, q.length - displayName.length - 1).replace(/,\s*$/, '').trim();
      if (city) return { city, stateAbbr: abbr };
    }
  }

  return { city: q, stateAbbr: null };
}

/**
 * Search local zip data by city name or zip prefix.
 * Supports "City, ST" and "City, State Name" formats to filter by state.
 * Returns up to `limit` results, deduplicated by city+state.
 * Exact city name matches are prioritized over prefix-only matches.
 */
export function searchLocal(query: string, limit: number = 8): ZipLookupResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const isDigits = /^\d+$/.test(q);
  const { city: cityQuery, stateAbbr } = isDigits ? { city: q, stateAbbr: null } : parseStateFilter(query);
  const expanded = isDigits ? cityQuery : expandAbbreviations(cityQuery);
  const cityLower = expanded.toLowerCase();

  const exact: ZipLookupResult[] = [];
  const prefix: ZipLookupResult[] = [];
  const seen = new Set<string>();

  for (const entry of zipData as ZipEntry[]) {
    const entryCityLower = entry.c.toLowerCase();

    if (isDigits) {
      if (!entry.z.startsWith(q)) continue;
    } else {
      if (!entryCityLower.startsWith(cityLower)) continue;
      // If state filter provided, enforce it
      if (stateAbbr && entry.s !== stateAbbr) continue;
    }

    // Deduplicate by city+state
    const key = `${entryCityLower}|${entry.s}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const state = STATE_DISPLAY[entry.s] || entry.s;
    const result: ZipLookupResult = {
      lat: entry.lat,
      lon: entry.lon,
      city: entry.c,
      state,
      zip: entry.z,
      countryCode: 'us',
    };

    if (!isDigits && entryCityLower === cityLower) {
      exact.push(result);
    } else {
      prefix.push(result);
    }

    // Collect enough candidates
    if (exact.length + prefix.length >= limit * 4) break;
  }

  return [...exact, ...prefix].slice(0, limit);
}
