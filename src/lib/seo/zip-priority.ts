// ── Step 176: Deterministic ZIP priority tiers ──────────────────────────
//
// Pure tier classifier for the ~41,000 ZIP forecast pages. Drives
// best-pages-first internal linking (homepage, state hubs, city hubs,
// ZIP-page nearby/related lists, internal-link module ordering) and
// admin SEO health reporting. **Derived entirely from data already
// shipped in the repo** — `priority-zip-content.ts` (Step 173 manual
// designations), `us-cities.ts` (curated list with built-in tier
// metadata), `astro.config.mjs`-equivalent city hub roster, and
// `us-zip-codes.json` (the ZIP dataset). No invented population,
// demand, climate, or impression facts.
//
// Tiers:
//   - 1 — manually designated priority ZIPs, ZIPs in tier-1 (major
//         metro) cities, and ZIPs in any city that already has a
//         dedicated city hub on the site.
//   - 2 — ZIPs in tier-2 / tier-3 (mid-size / mid-tier) curated cities.
//   - 3 — long-tail / everything else.
//
// **Pure**: no I/O. Safe to import from server endpoints, build-time
// sitemap generators, and Astro pages.

import { listPriorityZips } from '../priority-zip-content';
import { cities, type City } from '../us-cities';

/** Step 176 priority tier for a ZIP forecast page. */
export type ZipPriorityTier = 1 | 2 | 3;

/** Minimal ZIP record shape we rely on. Matches `us-zip-codes.json`. */
export interface ZipRecord {
  /** ZIP code, 5-digit zero-padded string. */
  z: string;
  /** City name. */
  c: string;
  /** State abbreviation (2 letters). */
  s: string;
  /** Latitude (optional — not used in tier logic but kept for typing). */
  lat?: number;
  /** Longitude. */
  lon?: number;
}

// ── City-hub roster ────────────────────────────────────────────────────
//
// Mirrors the Step 173 / 175 city-hub roster in `astro.config.mjs`. Add
// a new entry here at the same time you add a new city hub page; the
// tier helper auto-promotes every ZIP in those cities to Tier 1.

export interface CityHubEntry {
  state: string;
  city: string;
}

export const CITY_HUB_ROSTER: ReadonlyArray<CityHubEntry> = [
  { state: 'NY', city: 'New York' },
  { state: 'MN', city: 'Saint Paul' },
  { state: 'TX', city: 'Houston' },
  { state: 'TX', city: 'Dallas' },
  { state: 'OK', city: 'Oklahoma City' },
];

// ── Internal lookups (computed once at module load) ────────────────────

const PRIORITY_ZIP_SET: Set<string> = new Set(listPriorityZips().map((p) => p.zip));

const CITY_TIER_LOOKUP: Map<string, City['tier']> = (() => {
  const map = new Map<string, City['tier']>();
  for (const c of cities) {
    map.set(cityKey(c.state, c.name), c.tier);
  }
  return map;
})();

const CITY_HUB_SET: Set<string> = new Set(
  CITY_HUB_ROSTER.map((e) => cityKey(e.state, e.city)),
);

// ── Public helpers ─────────────────────────────────────────────────────

/** Deterministic Tier 1/2/3 classification for a ZIP record. Pure. */
export function getZipPriorityTier(record: ZipRecord): ZipPriorityTier {
  if (!record || typeof record.z !== 'string') return 3;
  if (PRIORITY_ZIP_SET.has(record.z)) return 1;
  const key = cityKey(record.s, record.c);
  if (CITY_HUB_SET.has(key)) return 1;
  const cityTier = CITY_TIER_LOOKUP.get(key);
  if (cityTier === 1) return 1;
  if (cityTier === 2 || cityTier === 3) return 2;
  return 3;
}

/** True iff this ZIP is in Tier 1. */
export function isTierOneZip(record: ZipRecord): boolean {
  return getZipPriorityTier(record) === 1;
}

/**
 * Stable sort by tier (1 best) with ZIP-string secondary key. Pure.
 * Does not mutate the input — returns a new array.
 */
export function sortZipPagesByPriority<T extends ZipRecord>(records: ReadonlyArray<T>): T[] {
  return records
    .slice()
    .sort((a, b) => {
      const at = getZipPriorityTier(a);
      const bt = getZipPriorityTier(b);
      if (at !== bt) return at - bt;
      return a.z.localeCompare(b.z);
    });
}

/**
 * Top-N tier-1 ZIPs in a state. When `limit` is undefined, returns all
 * Tier-1 ZIPs sorted by `(city tier, city name, zip)`. Always returns a
 * new array; never throws.
 */
export function getFeaturedZipsForState<T extends ZipRecord>(
  allZips: ReadonlyArray<T>,
  state: string,
  limit?: number,
): T[] {
  const stateClean = (state ?? '').toUpperCase();
  if (!stateClean) return [];
  const tierOnes = allZips.filter(
    (z) => z.s === stateClean && getZipPriorityTier(z) === 1,
  );
  const sorted = tierOnes.sort((a, b) => {
    const at = CITY_TIER_LOOKUP.get(cityKey(a.s, a.c)) ?? 5;
    const bt = CITY_TIER_LOOKUP.get(cityKey(b.s, b.c)) ?? 5;
    if (at !== bt) return at - bt;
    const cityCmp = a.c.localeCompare(b.c);
    if (cityCmp !== 0) return cityCmp;
    return a.z.localeCompare(b.z);
  });
  return typeof limit === 'number' ? sorted.slice(0, Math.max(0, limit)) : sorted;
}

/**
 * Top-N curated ZIPs in a city. Tier-1 ZIPs first (typically the
 * manually-designated priority ZIPs), then everything else in the same
 * city sorted by ZIP. Always returns a new array; never throws.
 */
export function getFeaturedZipsForCity<T extends ZipRecord>(
  allZips: ReadonlyArray<T>,
  state: string,
  city: string,
  limit = 20,
): T[] {
  const stateClean = (state ?? '').toUpperCase();
  const cityClean = (city ?? '').toLowerCase();
  if (!stateClean || !cityClean) return [];
  const subset = allZips.filter(
    (z) => z.s === stateClean && z.c.toLowerCase() === cityClean,
  );
  return sortZipPagesByPriority(subset).slice(0, Math.max(0, limit));
}

/**
 * Related ZIPs for a single ZIP page. Picks up to `limit` other ZIPs
 * in the same city (Tier 1 first), then falls back to other Tier-1
 * ZIPs in the same state if the city only has one ZIP. Drops the input
 * ZIP itself, dedupes, and returns a new array.
 */
export function getRelatedZipsForZip<T extends ZipRecord>(
  allZips: ReadonlyArray<T>,
  record: ZipRecord,
  limit = 8,
): T[] {
  if (!record || !record.z || !record.s) return [];
  const stateClean = record.s.toUpperCase();
  const cityClean = (record.c ?? '').toLowerCase();
  const seen = new Set<string>([record.z]);
  const out: T[] = [];

  // Pass 1: same-city ZIPs ranked by tier then ZIP.
  const sameCity = allZips.filter(
    (z) => z.s === stateClean && z.c.toLowerCase() === cityClean && !seen.has(z.z),
  );
  for (const z of sortZipPagesByPriority(sameCity)) {
    if (out.length >= limit) break;
    seen.add(z.z);
    out.push(z);
  }
  if (out.length >= limit) return out;

  // Pass 2: state-level Tier-1 ZIPs not yet included.
  const stateFeatured = allZips.filter(
    (z) => z.s === stateClean && !seen.has(z.z) && getZipPriorityTier(z) === 1,
  );
  for (const z of sortZipPagesByPriority(stateFeatured)) {
    if (out.length >= limit) break;
    seen.add(z.z);
    out.push(z);
  }
  return out;
}

/**
 * Counts of ZIPs per tier across the full dataset. Pure, used by the
 * admin SEO health dashboard.
 */
export function countZipsByTier<T extends ZipRecord>(
  allZips: ReadonlyArray<T>,
): { tier1: number; tier2: number; tier3: number; total: number } {
  let t1 = 0;
  let t2 = 0;
  let t3 = 0;
  for (const z of allZips) {
    const tier = getZipPriorityTier(z);
    if (tier === 1) t1 += 1;
    else if (tier === 2) t2 += 1;
    else t3 += 1;
  }
  return { tier1: t1, tier2: t2, tier3: t3, total: allZips.length };
}

// ── Internal helpers ───────────────────────────────────────────────────

function cityKey(state: string, city: string): string {
  return `${(state ?? '').toUpperCase()}|${(city ?? '').toLowerCase()}`;
}
