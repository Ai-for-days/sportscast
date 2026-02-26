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

/**
 * Search local zip data by city name or zip prefix.
 * Returns up to `limit` results, deduplicated by city+state.
 * Exact city name matches are prioritized over prefix-only matches.
 */
export function searchLocal(query: string, limit: number = 5): ZipLookupResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const isDigits = /^\d+$/.test(q);
  const exact: ZipLookupResult[] = [];
  const prefix: ZipLookupResult[] = [];
  const seen = new Set<string>();

  for (const entry of zipData as ZipEntry[]) {
    const cityLower = entry.c.toLowerCase();

    if (isDigits) {
      if (!entry.z.startsWith(q)) continue;
    } else {
      if (!cityLower.startsWith(q)) continue;
    }

    // Deduplicate by city+state
    const key = `${cityLower}|${entry.s}`;
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

    // For text searches, separate exact matches from prefix-only
    if (!isDigits && cityLower === q) {
      exact.push(result);
    } else {
      prefix.push(result);
    }

    // Collect enough candidates (exact + prefix combined)
    if (exact.length + prefix.length >= limit * 3) break;
  }

  // Exact matches first, then prefix matches, capped at limit
  return [...exact, ...prefix].slice(0, limit);
}
