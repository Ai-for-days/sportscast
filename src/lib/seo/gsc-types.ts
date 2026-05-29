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

// ── Step 177: Manual CSV import + reconciliation ───────────────────────
//
// Operators paste two CSVs from Search Console — the Page indexing
// export and the Performance export — into the admin SEO health
// dashboard. The types below describe the **post-parse** shapes that
// `gsc-import.ts` produces from those CSVs. The shapes are intentionally
// permissive: unknown columns are dropped, missing columns degrade to
// `undefined`, and malformed rows are surfaced via `warnings`.

/**
 * One row from the GSC "Pages" / URL-status export. Loosely typed
 * because Google has changed the column names over time. The parser
 * normalizes the canonical fields and stores anything unrecognized in
 * the optional `raw` field for debugging.
 */
export interface GscIndexingExportRow {
  /** Raw URL as it appeared in the CSV (may be www). */
  url: string;
  /** Canonical non-www URL the URL was rewritten to (or itself). */
  canonicalUrl: string;
  /** Status / Verdict cell. e.g. "Submitted and indexed". */
  status?: string;
  /** Reason / Issue cell. e.g. "Crawled - currently not indexed". */
  reason?: string;
  /** Source / Discovery method cell, e.g. "Sitemap". */
  source?: string;
  /** Validation / "Last crawl" timestamp (ISO if parseable, else raw). */
  lastCrawled?: string;
  /** Google-selected canonical, when GSC reports it. */
  googleCanonical?: string;
  /** User-declared canonical, when GSC reports it. */
  userCanonical?: string;
}

/**
 * One row from the GSC "Performance" → "Pages" export. Aggregated per
 * page across the export's date window.
 */
export interface GscPerformanceExportRow {
  url: string;
  canonicalUrl: string;
  impressions: number;
  clicks: number;
  /** CTR as a number 0.0–1.0. GSC exports it as a percentage; we
   *  normalize to fraction. `null` when impressions are 0. */
  ctr: GscCtr;
  /** Average position, or `null` if missing. */
  position: GscAveragePosition;
}

/**
 * Operator-facing recommendation. **Advisory only** — Step 177 does
 * not auto-mutate the site, the sitemap, the priority list, or any
 * link block. Operators read the queue, decide manually, and the
 * change ships in a separate code review.
 */
export type GscRecommendation =
  | 'promote'
  | 'strengthen_internal_links'
  | 'improve_ctr'
  | 'monitor'
  | 'deprioritize'
  | 'noindex_expected'
  | 'investigate_canonical'
  | 'investigate_error';

/**
 * One reconciled URL row. Joins the two CSVs to the site-side
 * Step 176 classifiers (route type / sitemap shard / ZIP priority
 * tier / noindex band) and attaches an advisory recommendation.
 */
export interface GscReconciledUrlRow {
  /** Non-www canonical for matching. */
  canonicalUrl: string;
  pathname: string;
  routeType: GscRouteType;
  /** URL of the child sitemap this page should appear in, or
   *  `undefined` when the URL is not eligible for any shard. */
  sitemapShard?: string;
  /** Set for ZIP forecast pages. */
  zipCode?: string;
  state?: string;
  city?: string;
  /** Set when `routeType === 'zip_page'`. */
  zipPriorityTier?: ZipPriorityTier;
  /** GSC indexing status, if found in the indexing CSV. */
  indexingStatus?: string;
  /** GSC indexing reason, if found. */
  indexingReason?: string;
  /** Mapped to the durable `GscNotIndexedReason` taxonomy when the
   *  raw reason matches a known bucket. Stays undefined for
   *  unmatched / indexed rows. */
  notIndexedReason?: GscNotIndexedReason;
  impressions?: number;
  clicks?: number;
  ctr?: GscCtr;
  averagePosition?: GscAveragePosition;
  recommendation: GscRecommendation;
  /** Short reason strings that explain the recommendation. */
  reasons: string[];
  /** Set when the canonical URL does not belong to this site
   *  (helps the dashboard surface stray external rows). */
  external?: boolean;
}

/**
 * Counts of indexed / not-indexed / etc. broken down by some key.
 */
export interface GscIndexStatusBreakdown {
  indexed: number;
  discoveredNotIndexed: number;
  crawledNotIndexed: number;
  alternateCanonical: number;
  duplicateNoCanonical: number;
  excludedNoindex: number;
  redirect: number;
  blockedByRobots: number;
  serverError: number;
  soft404: number;
  other: number;
  total: number;
}

export interface GscRouteTypeSummary {
  routeType: GscRouteType;
  totalSeen: number;
  status: GscIndexStatusBreakdown;
  impressions: number;
  clicks: number;
}

export interface GscTierSummary {
  tier: ZipPriorityTier;
  totalSeen: number;
  indexed: number;
  notIndexed: number;
  impressions: number;
  clicks: number;
}

export interface GscShardSummary {
  /** Canonical URL of the sitemap shard, e.g.
   *  `https://wageronweather.com/sitemap-zips-tx.xml`. */
  sitemapUrl: string;
  /** Display label, e.g. `ZIPs (TX)`. */
  label: string;
  /** Total URLs the shard declares (from the source-of-truth helper). */
  urlsInShard: number;
  /** Distinct URLs from this shard seen in any of the imported CSVs. */
  seenInGsc: number;
  indexed: number;
  notIndexed: number;
  impressions: number;
  clicks: number;
}

export interface GscCanonicalIssues {
  /** Number of indexing rows whose original URL was on the www host. */
  wwwUrlsSeen: number;
  /** Number of rows GSC labeled as alternate-canonical. */
  alternateCanonicalCount: number;
  /** Number of rows whose canonical does not match the page URL. */
  nonCanonicalCount: number;
  /** Distinct canonical URLs we could not match to any known route. */
  unknownUrlSamples: string[];
}

export interface GscImportWarnings {
  /** Free-text warnings raised by the parser (unknown headers, etc.). */
  parser: string[];
  /** Rows that could not be reconciled to a known route. */
  unmatched: number;
  /** Rows whose canonical was not on the wageronweather.com host. */
  external: number;
  /** Malformed rows that were skipped. */
  skipped: number;
}

export interface GscRecommendationQueueItem {
  canonicalUrl: string;
  pathname: string;
  routeType: GscRouteType;
  zipPriorityTier?: ZipPriorityTier;
  impressions?: number;
  clicks?: number;
  ctr?: GscCtr;
  averagePosition?: GscAveragePosition;
  indexingStatus?: string;
  notIndexedReason?: GscNotIndexedReason;
  reasons: string[];
}

export type GscQueueId =
  | 'tier1_not_indexed'
  | 'tier1_impressions_low_ctr'
  | 'city_hubs_low_impressions'
  | 'state_hubs_no_indexed_children'
  | 'discovered_not_indexed_strategic'
  | 'crawled_not_indexed'
  | 'alternate_canonical_or_duplicate_host'
  | 'noindex_expected'
  | 'promote_candidates'
  | 'deprioritize_candidates';

export interface GscRecommendationQueue {
  id: GscQueueId;
  title: string;
  description: string;
  /** Recommended action sentences shown to operators. */
  recommendedActions: ReadonlyArray<string>;
  items: GscRecommendationQueueItem[];
}

export interface GscReconciliationReport {
  generatedAt: string;
  /** Counts at a glance. */
  totals: {
    indexingRowsParsed: number;
    performanceRowsParsed: number;
    reconciledUrls: number;
    indexed: number;
    notIndexed: number;
    impressions: number;
    clicks: number;
  };
  warnings: GscImportWarnings;
  byRouteType: GscRouteTypeSummary[];
  byTier: GscTierSummary[];
  byShard: GscShardSummary[];
  canonicalIssues: GscCanonicalIssues;
  queues: GscRecommendationQueue[];
  /** Per-URL detail rows. Capped to keep the JSON payload bounded. */
  rows: GscReconciledUrlRow[];
}
