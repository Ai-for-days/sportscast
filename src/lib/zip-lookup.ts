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

/**
 * Look up a US zip code from the local cache.
 * Returns null if not found (caller should fall back to Nominatim).
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
  const cityLower = cityQuery.toLowerCase();

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
