// ── Step 188: Centralized location-page indexability ────────────────────
//
// Single source of truth for "should Google index this ZIP/location
// page?" — separate from "does this page exist / render for a
// visitor?" (it always does; see `src/pages/[...slug].astro`).
//
// Backed by `src/data/seo-indexable-locations.json`, an explicit,
// deliberately small allowlist. Nothing else in the codebase should
// make its own indexing decision for a ZIP/location page — sitemap
// generation (`sitemap-shards.ts`), the page's own `noindex` meta
// (`[...slug].astro` → `BaseLayout`), and internal-link tiering
// (`zip-priority.ts`) all consult this module.
//
// Replaces the unused/dead `indexation-policy.ts` (never imported
// anywhere — verified before deletion), which had drifted out of sync
// with how the sitemap and page-render code actually behaved.
//
// **Pure**: only reads the imported JSON allowlist. No I/O at call time.

import allowlistData from '../../data/seo-indexable-locations.json';

export interface LocationRef {
  zip: string;
  city?: string;
  state?: string;
}

interface AllowlistEntry {
  zip: string;
  city: string;
  stateAbbr: string;
  urlPath: string;
  reason: string;
}

const ALLOWLIST: readonly AllowlistEntry[] = (allowlistData.locations ?? []) as AllowlistEntry[];

const ALLOWLIST_ZIP_SET: ReadonlySet<string> = new Set(ALLOWLIST.map((e) => e.zip));

/**
 * Should Google be asked to index this location page?
 *
 * Decision is keyed on ZIP alone (the stable identifier — city/state
 * spelling in a URL is cosmetic, see `slug-utils.ts`). Returns `false`
 * for missing/empty ZIPs (e.g. the coordinate-fallback render path).
 */
export function shouldIndexLocationPage(location: LocationRef): boolean {
  const zip = (location?.zip ?? '').trim();
  if (!zip) return false;
  return ALLOWLIST_ZIP_SET.has(zip);
}

/** Every ZIP currently on the indexable allowlist. Pure, for callers that need the raw set. */
export function listIndexableZips(): ReadonlySet<string> {
  return ALLOWLIST_ZIP_SET;
}

/**
 * The exact URL path Google should see for an allowlisted ZIP, if the
 * allowlist specifies one explicitly. Most entries will match whatever
 * `buildLocationSlug()` generates anyway — but Cincinnati (45221) is a
 * deliberate exception, indexed under the legacy zip-first format (see
 * `LEGACY_URL_REDIRECT_EXCEPTIONS` in `[...slug].astro`). Sitemap
 * generation MUST use this — building the URL from scratch would emit a
 * second, un-redirected URL for the same page, recreating the exact
 * duplicate-content problem this allowlist exists to fix.
 */
export function getIndexableUrlPath(zip: string): string | undefined {
  return ALLOWLIST.find((e) => e.zip === zip)?.urlPath;
}

/** Full allowlist entries (zip/city/state/canonical URL/reason) — used by the admin SEO health dashboard and seo:audit script. */
export function listIndexableLocations(): readonly AllowlistEntry[] {
  return ALLOWLIST;
}
