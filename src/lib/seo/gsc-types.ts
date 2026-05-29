// ── Step 176: Search Console foundation types (types-only) ──────────────
//
// Pure TypeScript types that describe the shape of Search Console
// data we expect to consume in future steps. **No API integration in
// this step.** No fetch calls. No credential handling. The point of
// landing these types now is so future Step 177/178 can wire the GSC
// API without breaking the SEO health snapshot's contract.
//
// References (for future use, not consumed here):
//   - Search Analytics API:
//     https://developers.google.com/webmaster-tools/v1/searchanalytics
//   - URL Inspection API:
//     https://developers.google.com/webmaster-tools/v1/urlInspection.index
//   - Sitemaps API:
//     https://developers.google.com/webmaster-tools/v1/sitemaps

import type { ZipPriorityTier } from './zip-priority';

// ── Core metric primitives ─────────────────────────────────────────────

/** Whole impressions count for a URL or query during a date window. */
export type GscImpressions = number;
/** Whole click count for a URL or query during a date window. */
export type GscClicks = number;
/** Click-through rate (0.0–1.0). `null` when impressions are 0. */
export type GscCtr = number | null;
/** Average ranking position (1.0 = top of SERP). `null` when no data. */
export type GscAveragePosition = number | null;

// ── Indexation status ──────────────────────────────────────────────────

/**
 * Mirrors the URL Inspection API's `indexStatusResult.coverageState`
 * + `verdict` fields. Future loaders should map the raw GSC string to
 * one of these values.
 */
export type GscIndexedStatus =
  | 'indexed'
  | 'submitted_and_indexed'
  | 'crawled_not_indexed'
  | 'discovered_not_indexed'
  | 'alternate_canonical'
  | 'duplicate_no_user_canonical'
  | 'duplicate_user_canonical'
  | 'excluded_by_noindex'
  | 'soft_404'
  | 'server_error'
  | 'page_with_redirect'
  | 'blocked_by_robots_txt'
  | 'unknown';

/**
 * Coarse reason bucket for why a URL is not indexed. Used by the
 * future GSC reconciliation dashboard to group findings by mitigation
 * strategy rather than by raw GSC label.
 */
export type GscNotIndexedReason =
  | 'crawl_budget_or_priority'      // Discovered – currently not indexed
  | 'quality_or_uniqueness'         // Crawled – currently not indexed
  | 'canonical_consolidation'       // Alternate page with proper canonical
  | 'duplicate_no_signal'           // Duplicate, no user-selected canonical
  | 'noindex_directive'             // Excluded by noindex
  | 'redirect'                      // Page with redirect
  | 'robots_txt_blocked'            // Blocked by robots.txt
  | 'server_error'                  // 5xx
  | 'soft_404'                      // 200 with no useful content
  | 'unknown';

// ── Row records ────────────────────────────────────────────────────────

/**
 * One row of the Search Analytics API response, scoped to a single URL.
 * The future loader should aggregate over all queries before producing
 * one of these per URL per date window.
 */
export interface GscUrlPerformanceRow {
  /** Canonical URL on the non-www host. */
  url: string;
  /** Inclusive start date (`YYYY-MM-DD`). */
  windowStart: string;
  /** Inclusive end date (`YYYY-MM-DD`). */
  windowEnd: string;
  impressions: GscImpressions;
  clicks: GscClicks;
  ctr: GscCtr;
  averagePosition: GscAveragePosition;
}

/** Result of the URL Inspection API for a single URL. */
export interface GscUrlIndexationRow {
  url: string;
  /** When this inspection was fetched (ISO 8601). */
  inspectedAt: string;
  indexedStatus: GscIndexedStatus;
  /** Set when the URL is not indexed. */
  notIndexedReason?: GscNotIndexedReason;
  /** Google-selected canonical, when known. */
  googleCanonical?: string;
  /** Page-declared canonical, when known. */
  userCanonical?: string;
  /** Source sitemap URL that referenced this page (e.g.
   *  `https://wageronweather.com/sitemap-zips-tx.xml`). */
  referringSitemapUrl?: string;
}

// ── Site-level classifiers ─────────────────────────────────────────────

/**
 * Classifies a page by what it is on our site so GSC rows can be
 * sliced by route type without re-parsing pathnames every time.
 */
export type GscRouteType =
  | 'homepage'
  | 'state_hub'
  | 'city_hub'
  | 'zip_page'
  | 'venues_hub'
  | 'league_page'
  | 'map'
  | 'historical'
  | 'noindex_admin'
  | 'noindex_auth'
  | 'noindex_other'
  | 'unknown';

/**
 * One row that future Step 177+ dashboards will display per URL —
 * joins indexation + performance + site-side classification (route
 * type + priority tier) so operators can answer:
 *   "Are my Tier-1 ZIPs indexed at higher rates than my Tier-3 ZIPs?"
 *   "Which sitemap shard is producing the most `crawled_not_indexed`?"
 */
export interface GscReconciliationRow {
  url: string;
  routeType: GscRouteType;
  /** Set when `routeType === 'zip_page'`. */
  priorityTier?: ZipPriorityTier;
  /** Set when the URL was emitted in a sitemap. */
  sitemapUrl?: string;
  performance?: GscUrlPerformanceRow;
  indexation?: GscUrlIndexationRow;
}

// ── Sitemap submission ─────────────────────────────────────────────────

/** Status as reported by the Sitemaps API for a submitted shard. */
export interface GscSitemapShardStatus {
  /** Sitemap URL submitted to Search Console. */
  sitemapUrl: string;
  /** ISO timestamp of last GSC submission. */
  lastSubmitted?: string;
  /** ISO timestamp of last GSC download. */
  lastDownloaded?: string;
  /** Count of URLs GSC discovered in the shard. */
  discoveredUrlCount?: number;
  /** Count of URLs GSC has indexed from the shard. */
  indexedUrlCount?: number;
  /** Free-text warning, e.g. "URLs not followed". */
  warnings?: ReadonlyArray<string>;
  /** Free-text errors. */
  errors?: ReadonlyArray<string>;
}

// ── Top-level snapshot ────────────────────────────────────────────────

/**
 * Aggregate snapshot that the future GSC reconciliation page will
 * render. Wraps all per-URL + per-sitemap data behind a single
 * generation timestamp.
 */
export interface GscDashboardSnapshot {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  rows: GscReconciliationRow[];
  sitemapShards: GscSitemapShardStatus[];
  /** Optional aggregate counters for the dashboard header. */
  totals?: {
    impressions: GscImpressions;
    clicks: GscClicks;
    averagePosition: GscAveragePosition;
    indexedCount: number;
    crawledNotIndexedCount: number;
    discoveredNotIndexedCount: number;
  };
}
