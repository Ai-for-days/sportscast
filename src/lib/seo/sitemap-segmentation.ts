// ── Step 175: Sitemap segmentation helpers ──────────────────────────────
//
// Pure helpers that compute which segment a public URL belongs in.
// The live `sitemap-index.xml` is still produced by Astro's
// `@astrojs/sitemap` integration, which auto-segments at the
// `entryLimit` (10,000) boundary. That works for crawl efficiency but
// the segments are named `sitemap-0.xml`, `sitemap-1.xml`, … with no
// semantic grouping.
//
// This module defines the four semantic segments the Step 175 spec
// asks for so a future migration can swap them in without changing
// any consumer code:
//
//   - `pages`   — homepage + venues + map + historical + other top-of-funnel
//   - `states`  — `/weather/{state}` state hubs (~51)
//   - `cities`  — `/weather/{state}/{city}` city hubs
//   - `zips`    — `/united-states-{state}-{city?}-{zip}` ZIP forecasts
//
// Used by `scripts/verify-seo-routing.mjs` to know which child sitemap
// to expect a given URL in, and by future custom sitemap emitters.
//
// Pure: no I/O. Input is a pathname; output is a `SitemapSegment`.

import { isNoIndexPathname } from './noindex-policy';

export type SitemapSegment = 'pages' | 'states' | 'cities' | 'zips' | 'exclude';

export interface SitemapAssignment {
  segment: SitemapSegment;
  reason: string;
}

/** Decide the sitemap segment for a pathname. Pure. */
export function assignSitemapSegment(pathname: string): SitemapAssignment {
  if (!pathname || typeof pathname !== 'string') {
    return { segment: 'exclude', reason: 'empty_pathname' };
  }
  const p = normalize(pathname);

  if (isNoIndexPathname(p)) {
    return { segment: 'exclude', reason: 'noindex_route_group' };
  }
  if (p === '' || p === '/') {
    return { segment: 'pages', reason: 'homepage' };
  }
  if (p === '/venues' || p.startsWith('/venues/')) {
    return { segment: 'pages', reason: 'venues' };
  }
  if (p === '/map' || p === '/historical') {
    return { segment: 'pages', reason: 'top_funnel' };
  }
  if (p.startsWith('/weather/')) {
    const depth = p.split('/').filter(Boolean).length;
    if (depth === 2) return { segment: 'states', reason: 'state_hub' };
    if (depth === 3) return { segment: 'cities', reason: 'city_hub' };
    return { segment: 'exclude', reason: 'deep_weather_unknown' };
  }
  if (/^\/united-states-/.test(p)) {
    return { segment: 'zips', reason: 'zip_forecast' };
  }
  if (p.startsWith('/forecast/')) {
    return { segment: 'exclude', reason: 'coordinate_fallback' };
  }
  return { segment: 'pages', reason: 'other_public' };
}

/** ZIP segment chunk size. Mirrors Astro's default `entryLimit` so the
 *  current child sitemaps stay aligned with the documented segments. */
export const ZIP_SEGMENT_CHUNK_SIZE = 10_000;

/** Returns the 1-based chunk index for a ZIP URL within the `zips`
 *  segment, given the position of its pathname in a stably-ordered
 *  list of all ZIP URLs. */
export function zipChunkIndex(positionInList: number): number {
  if (positionInList < 0) return 1;
  return Math.floor(positionInList / ZIP_SEGMENT_CHUNK_SIZE) + 1;
}

function normalize(p: string): string {
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}
