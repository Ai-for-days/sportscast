// ── Step 174 / 175: Indexation policy classifier ───────────────────────
//
// Returns a coarse policy band for any pathname so downstream consumers
// (sitemap filter, future analytics dashboards, GSC ↔ code reconciliation
// tooling) can make consistent decisions about which pages should rank.
//
// Bands (per spec):
//   - `index`                     — actively want to rank.
//   - `crawlable_deprioritized`   — keep crawlable, but don't push.
//   - `noindex`                   — block from index.
//   - `consolidate_candidate`     — duplicate / canonical merge target.
//
// Step 175 — the band assignments also drive the documented sitemap
// segmentation map in `seo/sitemap-segmentation.ts`. `index` and
// `crawlable_deprioritized` URLs land in a child sitemap; `noindex`
// and `consolidate_candidate` URLs do not.
//
// **Pure**: only inspects pathname. No I/O.

import { listPriorityZips } from '../priority-zip-content';
import { isNoIndexPathname } from './noindex-policy';

export type IndexationBand =
  | 'index'
  | 'crawlable_deprioritized'
  | 'noindex'
  | 'consolidate_candidate';

export interface IndexationDecision {
  band: IndexationBand;
  /** Short reason suitable for the GSC reconciliation doc. */
  reason: string;
}

const PRIORITY_ZIP_PATHS: Set<string> = new Set();
for (const p of listPriorityZips()) {
  // `priority-zip-content.ts` doesn't carry the full slug, so just
  // memoize by ZIP for the suffix check below.
  PRIORITY_ZIP_PATHS.add(p.zip);
}

/**
 * Classify a pathname into one of the four policy bands.
 *
 * Rules:
 *   - Private / admin / dashboard / auth / system → `noindex`.
 *   - Homepage / state hubs / city hubs / venues / map / historical /
 *     priority ZIP pages → `index`.
 *   - Generic ZIP forecast pages → `crawlable_deprioritized` by
 *     default (per spec: "keep normal ZIP forecast pages crawlable by
 *     default"); promote to `index` later via GSC impression data.
 *   - Coordinate-fallback paths (`/forecast/{lat},{lon}`) → `consolidate_candidate`.
 *   - Everything else → `crawlable_deprioritized`.
 */
export function classifyIndexationBand(pathname: string): IndexationDecision {
  if (!pathname || typeof pathname !== 'string') {
    return { band: 'crawlable_deprioritized', reason: 'empty_pathname' };
  }
  const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  if (isNoIndexPathname(p)) {
    return { band: 'noindex', reason: 'route_group_in_noindex_policy' };
  }

  // Indexable public surfaces.
  if (p === '' || p === '/') return { band: 'index', reason: 'homepage' };
  if (p === '/venues' || p.startsWith('/venues/')) {
    return { band: 'index', reason: 'venues_hub' };
  }
  if (p === '/map') return { band: 'index', reason: 'map' };
  if (p === '/historical') return { band: 'index', reason: 'historical' };

  // State + city hubs.
  if (p.startsWith('/weather/')) {
    const depth = p.split('/').filter(Boolean).length; // weather/{state} → 2; weather/{state}/{city} → 3
    if (depth === 2) return { band: 'index', reason: 'state_hub' };
    if (depth === 3) return { band: 'index', reason: 'city_hub' };
    return { band: 'crawlable_deprioritized', reason: 'unknown_weather_path' };
  }

  // ZIP / location pages (`/united-states-{state}-{city?}-{zip}`).
  if (/^\/united-states-/.test(p)) {
    const match = p.match(/(\d{5})$/);
    const zip = match?.[1];
    if (zip && PRIORITY_ZIP_PATHS.has(zip)) {
      return { band: 'index', reason: 'priority_zip' };
    }
    return { band: 'crawlable_deprioritized', reason: 'generic_zip' };
  }

  // Coordinate fallback paths.
  if (p.startsWith('/forecast/')) {
    return { band: 'consolidate_candidate', reason: 'coordinate_fallback' };
  }

  return { band: 'crawlable_deprioritized', reason: 'uncategorized' };
}

/**
 * Convenience: should this pathname appear in the sitemap?
 * Pure — derives from the indexation band.
 */
export function shouldIncludeInSitemap(pathname: string): boolean {
  const decision = classifyIndexationBand(pathname);
  return decision.band === 'index';
}
