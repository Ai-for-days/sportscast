// ── Step 177: Manual Search Console CSV import + reconciliation ─────────
//
// Operators paste two CSV exports from Google Search Console — the
// "Pages" / URL-status export and the "Performance" → "Pages" export —
// into the admin SEO health dashboard. This module owns the parsing,
// normalization, and reconciliation pipeline:
//
//   1. `parseGscIndexingCsv(csvText)`     → GscIndexingExportRow[]
//   2. `parseGscPerformanceCsv(csvText)`  → GscPerformanceExportRow[]
//   3. `normalizeGscUrl(url)`             → canonical non-www
//   4. `classifyRouteType(pathname)`      → GscRouteType
//   5. `classifyGscRecommendation(row)`   → GscRecommendation + reasons
//   6. `reconcileGscRows(indexing, perf)` → GscReconciliationReport
//
// **Never throws.** Malformed rows are skipped and counted in the
// `warnings.skipped` field. Unknown URLs are flagged via
// `warnings.external` and surfaced in `canonicalIssues.unknownUrlSamples`.
//
// **No I/O.** No `fetch`, no Redis, no credentials. Pure functions
// over CSV strings + the Step 176 ZIP dataset. Safe to call from an
// admin API endpoint.

import zipData from '../../data/us-zip-codes.json';
import {
  CANONICAL_HOST,
  assignSitemapShard,
  listShardManifest,
} from './sitemap-shards';
import {
  getZipPriorityTier,
  type ZipPriorityTier,
  type ZipRecord,
} from './zip-priority';
import type {
  GscCanonicalIssues,
  GscCtr,
  GscIndexingExportRow,
  GscImportWarnings,
  GscIndexStatusBreakdown,
  GscNotIndexedReason,
  GscPerformanceExportRow,
  GscReconciledUrlRow,
  GscReconciliationReport,
  GscRecommendation,
  GscRecommendationQueue,
  GscRecommendationQueueItem,
  GscRouteType,
  GscRouteTypeSummary,
  GscShardSummary,
  GscTierSummary,
} from './gsc-types';

const NON_WWW_HOST = CANONICAL_HOST;
const WWW_HOST = 'https://www.wageronweather.com';
const MAX_ROWS_IN_REPORT = 5_000;
const MAX_QUEUE_ITEMS = 50;
const MAX_UNKNOWN_URL_SAMPLES = 25;

const ZIP_RECORDS = zipData as ZipRecord[];

// ── CSV parsing ────────────────────────────────────────────────────────
//
// Hand-rolled, tolerant of CSV + TSV exports. RFC 4180 quoted fields
// are honored. Whitespace-only rows are dropped. Headers are
// normalized to lowercase + non-alphanumeric collapsed to `_`.

/** Parse a CSV/TSV blob into an array of `Record<string, string>`. */
export function parseCsv(text: string): { rows: Record<string, string>[]; headers: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!text || typeof text !== 'string') {
    return { rows: [], headers: [], warnings };
  }
  const trimmed = stripBom(text).trim();
  if (!trimmed) return { rows: [], headers: [], warnings };

  // Detect delimiter from the first non-empty line.
  const firstLine = trimmed.slice(0, 4096).split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const lines: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuotes) {
      if (ch === '"') {
        if (trimmed[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // Skip pure \r when paired with \n.
      if (ch === '\r' && trimmed[i + 1] === '\n') continue;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') lines.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  // Final cell + final row.
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    if (row.length > 1 || row[0] !== '') lines.push(row);
  }
  if (inQuotes) warnings.push('csv ended with unmatched quote');

  if (lines.length === 0) return { rows: [], headers: [], warnings };
  const rawHeaders = lines[0].map((h) => h.trim());
  const headers = rawHeaders.map(normalizeHeader);
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cells[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return { rows, headers: rawHeaders, warnings };
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/^"|"$/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// ── GSC indexing CSV ───────────────────────────────────────────────────

/** Column-name aliases for each known field on the indexing export. */
const INDEXING_FIELD_ALIASES: Record<keyof GscIndexingExportRow, ReadonlyArray<string>> = {
  url: ['url', 'page', 'page_url', 'address'],
  canonicalUrl: ['canonical_url', 'user_canonical'],
  status: ['status', 'verdict', 'index_status', 'coverage_state'],
  reason: ['reason', 'issue', 'detection', 'detail'],
  source: ['source', 'discovery_method'],
  lastCrawled: ['last_crawled', 'last_crawl', 'last_crawl_date', 'last_crawled_date'],
  googleCanonical: ['google_canonical', 'google_selected_canonical'],
  userCanonical: ['user_canonical', 'user_declared_canonical', 'declared_canonical'],
};

export function parseGscIndexingCsv(csvText: string): { rows: GscIndexingExportRow[]; warnings: string[] } {
  const { rows, warnings } = parseCsv(csvText);
  const out: GscIndexingExportRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const url = pickField(r, INDEXING_FIELD_ALIASES.url);
    if (!url) {
      skipped += 1;
      continue;
    }
    const canonical = normalizeGscUrl(url);
    if (!canonical) {
      skipped += 1;
      continue;
    }
    out.push({
      url,
      canonicalUrl: canonical,
      status: pickField(r, INDEXING_FIELD_ALIASES.status) || undefined,
      reason: pickField(r, INDEXING_FIELD_ALIASES.reason) || undefined,
      source: pickField(r, INDEXING_FIELD_ALIASES.source) || undefined,
      lastCrawled: pickField(r, INDEXING_FIELD_ALIASES.lastCrawled) || undefined,
      googleCanonical: pickField(r, INDEXING_FIELD_ALIASES.googleCanonical) || undefined,
      userCanonical: pickField(r, INDEXING_FIELD_ALIASES.userCanonical) || undefined,
    });
  }
  if (skipped > 0) warnings.push(`indexing: skipped ${skipped} rows without a URL`);
  return { rows: out, warnings };
}

// ── GSC performance CSV ───────────────────────────────────────────────

const PERFORMANCE_FIELD_ALIASES = {
  url: ['top_pages', 'page', 'page_url', 'url', 'address'],
  impressions: ['impressions'],
  clicks: ['clicks'],
  ctr: ['ctr', 'click_through_rate'],
  position: ['position', 'average_position', 'avg_position'],
} as const;

export function parseGscPerformanceCsv(csvText: string): { rows: GscPerformanceExportRow[]; warnings: string[] } {
  const { rows, warnings } = parseCsv(csvText);
  const out: GscPerformanceExportRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const url = pickField(r, PERFORMANCE_FIELD_ALIASES.url);
    if (!url) {
      skipped += 1;
      continue;
    }
    const canonical = normalizeGscUrl(url);
    if (!canonical) {
      skipped += 1;
      continue;
    }
    const impressions = parseIntSafe(pickField(r, PERFORMANCE_FIELD_ALIASES.impressions));
    const clicks = parseIntSafe(pickField(r, PERFORMANCE_FIELD_ALIASES.clicks));
    const ctrRaw = pickField(r, PERFORMANCE_FIELD_ALIASES.ctr);
    const positionRaw = pickField(r, PERFORMANCE_FIELD_ALIASES.position);
    out.push({
      url,
      canonicalUrl: canonical,
      impressions,
      clicks,
      ctr: parseCtr(ctrRaw, impressions, clicks),
      position: parsePosition(positionRaw),
    });
  }
  if (skipped > 0) warnings.push(`performance: skipped ${skipped} rows without a URL`);
  return { rows: out, warnings };
}

function pickField(record: Record<string, string>, aliases: ReadonlyArray<string>): string {
  for (const a of aliases) {
    const v = record[a];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function parseIntSafe(s: string): number {
  if (!s) return 0;
  const clean = s.replace(/[,\s]/g, '').replace(/^"|"$/g, '');
  const n = parseInt(clean, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseCtr(raw: string, impressions: number, clicks: number): GscCtr {
  if (raw) {
    const clean = raw.replace(/[%\s,"]/g, '');
    const n = parseFloat(clean);
    if (Number.isFinite(n)) {
      // GSC reports CTR as a percentage (e.g. "1.23"). Anything > 1
      // is treated as a percentage; ≤ 1 is treated as a fraction.
      return n > 1 ? n / 100 : n;
    }
  }
  if (impressions > 0) return clicks / impressions;
  return null;
}

function parsePosition(raw: string): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[\s,"]/g, '');
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

// ── URL normalization ─────────────────────────────────────────────────

/**
 * Normalize a raw GSC URL string to its canonical non-www equivalent.
 * Returns `''` when the URL is unparseable. **Never throws.**
 *
 *   `https://www.wageronweather.com/foo/` → `https://wageronweather.com/foo`
 *   `https://wageronweather.com/`         → `https://wageronweather.com/`
 *   `http://wageronweather.com/foo`       → `https://wageronweather.com/foo`
 *   `https://other.example.com/foo`       → `https://other.example.com/foo` (external)
 */
export function normalizeGscUrl(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/^"|"$/g, '');
  if (!trimmed) return '';
  let candidate = trimmed;
  // Strip Search Console's URL prefix when operators paste the
  // "Filter URL" string.
  candidate = candidate.replace(/^URL\s+contains\s+/i, '').trim();
  // Add scheme when missing.
  if (!/^https?:\/\//i.test(candidate)) {
    if (candidate.startsWith('//')) candidate = `https:${candidate}`;
    else if (candidate.startsWith('/')) candidate = `${NON_WWW_HOST}${candidate}`;
    else candidate = `https://${candidate}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return '';
  }
  // Lowercase host. Strip optional `:443` / `:80` ports.
  let host = parsed.host.toLowerCase().replace(/:(80|443)$/, '');
  if (host === 'www.wageronweather.com') host = 'wageronweather.com';
  const proto = host === 'wageronweather.com' ? 'https' : parsed.protocol.replace(':', '') || 'https';
  // Drop trailing slash except for `/`.
  let path = parsed.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  // Drop fragment + query — GSC URLs should not have either, but
  // strip defensively.
  return `${proto}://${host}${path}`;
}

/** True iff the canonical URL is on the wageronweather.com host. */
export function isInternalCanonicalUrl(canonical: string): boolean {
  if (!canonical) return false;
  return canonical.startsWith(`${NON_WWW_HOST}/`) || canonical === NON_WWW_HOST;
}

/** Was the *original* raw URL on the www host (signals legacy 301 candidates). */
export function wasWwwUrl(raw: string): boolean {
  if (!raw) return false;
  return /^https?:\/\/www\.wageronweather\.com/i.test(raw.trim());
}

// ── Route type classification ─────────────────────────────────────────

export function classifyRouteType(pathname: string): GscRouteType {
  if (!pathname || typeof pathname !== 'string') return 'unknown';
  const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (p.startsWith('/admin')) return 'noindex_admin';
  if (p.startsWith('/api/admin')) return 'noindex_admin';
  if (p.startsWith('/api/')) return 'noindex_other';
  if (
    p === '/login' || p.startsWith('/login/') ||
    p === '/signup' || p.startsWith('/signup/') ||
    p.startsWith('/api/auth') ||
    p === '/account' || p.startsWith('/account/')
  ) {
    return 'noindex_auth';
  }
  if (
    p.startsWith('/dashboard') || p.startsWith('/settings') ||
    p.startsWith('/preview') || p.startsWith('/internal') || p.startsWith('/_dev')
  ) {
    return 'noindex_other';
  }
  if (p === '' || p === '/') return 'homepage';
  if (p === '/venues' || p === '/venues/') return 'venues_hub';
  if (/^\/venues\/[^/]+$/.test(p)) return 'league_page';
  if (p === '/map') return 'map';
  if (p === '/historical') return 'historical';
  if (p.startsWith('/weather/')) {
    const depth = p.split('/').filter(Boolean).length;
    if (depth === 2) return 'state_hub';
    if (depth === 3) return 'city_hub';
    return 'unknown';
  }
  if (/^\/united-states-/.test(p)) return 'zip_page';
  return 'unknown';
}

// ── Reason mapping ────────────────────────────────────────────────────

function mapNotIndexedReason(reason?: string, status?: string): GscNotIndexedReason | undefined {
  const haystack = `${reason ?? ''} ${status ?? ''}`.toLowerCase();
  if (!haystack.trim()) return undefined;
  if (/discovered.*not indexed/.test(haystack)) return 'crawl_budget_or_priority';
  if (/crawled.*not indexed/.test(haystack)) return 'quality_or_uniqueness';
  if (/alternate page.*canonical/.test(haystack) || /\balternate canonical\b/.test(haystack)) {
    return 'canonical_consolidation';
  }
  if (/duplicate.*without.*canonical/.test(haystack) || /duplicate.*no user/.test(haystack)) {
    return 'duplicate_no_signal';
  }
  if (/excluded.*noindex|noindex.*tag/.test(haystack)) return 'noindex_directive';
  if (/redirect/.test(haystack)) return 'redirect';
  if (/blocked.*robots/.test(haystack)) return 'robots_txt_blocked';
  if (/server error|5xx/.test(haystack)) return 'server_error';
  if (/soft 404/.test(haystack)) return 'soft_404';
  return 'unknown';
}

function isIndexedStatus(status?: string): boolean {
  const s = (status ?? '').toLowerCase();
  if (!s) return false;
  if (/indexed/.test(s) && !/not indexed/.test(s)) return true;
  if (/submitted and indexed/.test(s)) return true;
  return false;
}

// ── Recommendation classification ─────────────────────────────────────

interface RecommendationInput {
  routeType: GscRouteType;
  tier?: ZipPriorityTier;
  indexed: boolean;
  notIndexedReason?: GscNotIndexedReason;
  impressions: number;
  clicks: number;
  ctr: GscCtr;
  position: number | null;
  /** True when GSC noted the URL was on the www host. */
  wasWww: boolean;
  external: boolean;
}

const LOW_CTR_THRESHOLD = 0.01; // 1%
const LOW_POSITION_THRESHOLD = 20; // outside top 20 → CTR fixes less useful

export function classifyGscRecommendation(input: RecommendationInput): { recommendation: GscRecommendation; reasons: string[] } {
  const reasons: string[] = [];

  if (input.external) {
    reasons.push('canonical URL is not on wageronweather.com');
    return { recommendation: 'investigate_canonical', reasons };
  }

  if (
    input.routeType === 'noindex_admin' ||
    input.routeType === 'noindex_auth' ||
    input.routeType === 'noindex_other'
  ) {
    reasons.push('private route group — noindex expected');
    return { recommendation: 'noindex_expected', reasons };
  }

  if (input.notIndexedReason === 'server_error' || input.notIndexedReason === 'soft_404') {
    reasons.push(`GSC reports ${input.notIndexedReason}`);
    return { recommendation: 'investigate_error', reasons };
  }

  if (
    input.notIndexedReason === 'canonical_consolidation' ||
    input.notIndexedReason === 'duplicate_no_signal' ||
    input.notIndexedReason === 'redirect' ||
    input.wasWww
  ) {
    if (input.wasWww) reasons.push('legacy www URL — verify 301 is firing');
    if (input.notIndexedReason === 'canonical_consolidation') reasons.push('alternate canonical — confirm consolidation target');
    if (input.notIndexedReason === 'duplicate_no_signal') reasons.push('duplicate without GSC-selected canonical');
    if (input.notIndexedReason === 'redirect') reasons.push('GSC sees this URL as a redirect target');
    return { recommendation: 'investigate_canonical', reasons };
  }

  if (input.notIndexedReason === 'noindex_directive') {
    reasons.push('GSC respects our noindex directive');
    return { recommendation: 'noindex_expected', reasons };
  }

  if (
    !input.indexed && input.routeType === 'zip_page' && input.tier === 1
  ) {
    reasons.push('Tier-1 ZIP not indexed — strengthen hub linking');
    if (input.notIndexedReason === 'crawl_budget_or_priority') {
      reasons.push('discovered, not indexed — crawl priority concern');
    } else if (input.notIndexedReason === 'quality_or_uniqueness') {
      reasons.push('crawled, not indexed — uniqueness concern');
    }
    return { recommendation: 'strengthen_internal_links', reasons };
  }

  if (
    !input.indexed && (input.routeType === 'state_hub' || input.routeType === 'city_hub')
  ) {
    reasons.push(`${input.routeType.replace('_', ' ')} not indexed — strengthen hub linking`);
    return { recommendation: 'strengthen_internal_links', reasons };
  }

  if (
    input.indexed &&
    input.impressions > 0 &&
    input.routeType === 'zip_page' &&
    (input.tier === 2 || input.tier === 3)
  ) {
    reasons.push(`Tier-${input.tier} ZIP earning impressions (${input.impressions})`);
    if (input.clicks > 0) reasons.push(`${input.clicks} clicks observed`);
    return { recommendation: 'promote', reasons };
  }

  if (
    input.indexed &&
    input.impressions >= 25 &&
    input.ctr !== null && input.ctr < LOW_CTR_THRESHOLD &&
    (input.position === null || input.position <= LOW_POSITION_THRESHOLD)
  ) {
    reasons.push(`${input.impressions} impressions but CTR < ${LOW_CTR_THRESHOLD}`);
    if (input.position !== null) reasons.push(`average position ${input.position.toFixed(1)}`);
    return { recommendation: 'improve_ctr', reasons };
  }

  if (
    !input.indexed &&
    input.routeType === 'zip_page' &&
    input.tier === 3 &&
    input.impressions === 0 && input.clicks === 0
  ) {
    reasons.push('long-tail ZIP with no impressions and not indexed');
    return { recommendation: 'deprioritize', reasons };
  }

  if (input.indexed) {
    reasons.push('indexed — no immediate action');
    return { recommendation: 'monitor', reasons };
  }

  reasons.push('not indexed — monitor next recrawl');
  return { recommendation: 'monitor', reasons };
}

// ── Reconciliation ────────────────────────────────────────────────────

const ZIP_BY_CODE: Map<string, ZipRecord> = (() => {
  const m = new Map<string, ZipRecord>();
  for (const z of ZIP_RECORDS) m.set(z.z, z);
  return m;
})();

function extractZipFromPath(p: string): string | undefined {
  const match = p.match(/-(\d{5})$/);
  return match ? match[1] : undefined;
}

export function reconcileGscRows(
  indexingRows: GscIndexingExportRow[],
  performanceRows: GscPerformanceExportRow[],
  parserWarnings: string[] = [],
): GscReconciliationReport {
  // Index performance rows by canonical URL for fast join.
  const perfByUrl = new Map<string, GscPerformanceExportRow>();
  for (const p of performanceRows) {
    if (p.canonicalUrl) perfByUrl.set(p.canonicalUrl, p);
  }

  // Build the canonical universe: every URL we saw in either CSV.
  const allCanonicals = new Set<string>();
  for (const r of indexingRows) if (r.canonicalUrl) allCanonicals.add(r.canonicalUrl);
  for (const p of performanceRows) if (p.canonicalUrl) allCanonicals.add(p.canonicalUrl);

  const indexingByUrl = new Map<string, GscIndexingExportRow>();
  for (const r of indexingRows) if (r.canonicalUrl) indexingByUrl.set(r.canonicalUrl, r);

  const warnings: GscImportWarnings = {
    parser: parserWarnings.slice(),
    unmatched: 0,
    external: 0,
    skipped: 0,
  };

  const canonicalIssues: GscCanonicalIssues = {
    wwwUrlsSeen: 0,
    alternateCanonicalCount: 0,
    nonCanonicalCount: 0,
    unknownUrlSamples: [],
  };

  const rows: GscReconciledUrlRow[] = [];
  let totalImpressions = 0;
  let totalClicks = 0;
  let indexedCount = 0;
  let notIndexedCount = 0;

  for (const canonical of allCanonicals) {
    const pathname = pathnameOf(canonical);
    const idx = indexingByUrl.get(canonical);
    const perf = perfByUrl.get(canonical);

    const external = !isInternalCanonicalUrl(canonical);
    if (external) {
      canonicalIssues.unknownUrlSamples = pushSample(
        canonicalIssues.unknownUrlSamples,
        canonical,
        MAX_UNKNOWN_URL_SAMPLES,
      );
      warnings.external += 1;
    }

    const routeType = external ? 'unknown' : classifyRouteType(pathname);
    const sitemapShard = external ? undefined : assignSitemapShard(pathname);
    const zipCode = routeType === 'zip_page' ? extractZipFromPath(pathname) : undefined;
    const zipRecord = zipCode ? ZIP_BY_CODE.get(zipCode) : undefined;
    const tier = zipRecord ? getZipPriorityTier(zipRecord) : undefined;

    const wasWww = idx ? wasWwwUrl(idx.url) : false;
    if (wasWww) canonicalIssues.wwwUrlsSeen += 1;

    const indexed = idx ? isIndexedStatus(idx.status) : false;
    const notIndexedReason = idx ? mapNotIndexedReason(idx.reason, idx.status) : undefined;

    if (notIndexedReason === 'canonical_consolidation') canonicalIssues.alternateCanonicalCount += 1;
    if (idx?.googleCanonical && idx.googleCanonical !== canonical) canonicalIssues.nonCanonicalCount += 1;

    if (idx) {
      if (indexed) indexedCount += 1;
      else notIndexedCount += 1;
    }
    if (perf) {
      totalImpressions += perf.impressions || 0;
      totalClicks += perf.clicks || 0;
    }

    const { recommendation, reasons } = classifyGscRecommendation({
      routeType,
      tier,
      indexed,
      notIndexedReason,
      impressions: perf?.impressions ?? 0,
      clicks: perf?.clicks ?? 0,
      ctr: perf?.ctr ?? null,
      position: perf?.position ?? null,
      wasWww,
      external,
    });

    const row: GscReconciledUrlRow = {
      canonicalUrl: canonical,
      pathname,
      routeType,
      sitemapShard,
      zipCode,
      state: zipRecord?.s,
      city: zipRecord?.c,
      zipPriorityTier: tier,
      indexingStatus: idx?.status,
      indexingReason: idx?.reason,
      notIndexedReason,
      impressions: perf?.impressions,
      clicks: perf?.clicks,
      ctr: perf?.ctr ?? undefined,
      averagePosition: perf?.position ?? undefined,
      recommendation,
      reasons,
      external: external || undefined,
    };

    if (routeType === 'unknown' && !external) {
      warnings.unmatched += 1;
    }

    rows.push(row);
  }

  rows.sort((a, b) => {
    const ai = (a.impressions ?? 0);
    const bi = (b.impressions ?? 0);
    if (bi !== ai) return bi - ai;
    return a.canonicalUrl.localeCompare(b.canonicalUrl);
  });

  const byRouteType = summarizeByRouteType(rows);
  const byTier = summarizeByTier(rows);
  const byShard = summarizeByShard(rows);
  const queues = buildGscQueues(rows);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      indexingRowsParsed: indexingRows.length,
      performanceRowsParsed: performanceRows.length,
      reconciledUrls: rows.length,
      indexed: indexedCount,
      notIndexed: notIndexedCount,
      impressions: totalImpressions,
      clicks: totalClicks,
    },
    warnings,
    byRouteType,
    byTier,
    byShard,
    canonicalIssues,
    queues,
    rows: rows.slice(0, MAX_ROWS_IN_REPORT),
  };
}

function pathnameOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || '/';
  } catch {
    return '/';
  }
}

function pushSample(arr: string[], v: string, max: number): string[] {
  if (arr.length >= max) return arr;
  if (arr.includes(v)) return arr;
  return [...arr, v];
}

// ── Summaries ────────────────────────────────────────────────────────

function emptyStatusBreakdown(): GscIndexStatusBreakdown {
  return {
    indexed: 0,
    discoveredNotIndexed: 0,
    crawledNotIndexed: 0,
    alternateCanonical: 0,
    duplicateNoCanonical: 0,
    excludedNoindex: 0,
    redirect: 0,
    blockedByRobots: 0,
    serverError: 0,
    soft404: 0,
    other: 0,
    total: 0,
  };
}

function bumpStatus(b: GscIndexStatusBreakdown, row: GscReconciledUrlRow) {
  b.total += 1;
  if (row.indexingStatus && isIndexedStatus(row.indexingStatus)) {
    b.indexed += 1;
    return;
  }
  switch (row.notIndexedReason) {
    case 'crawl_budget_or_priority':
      b.discoveredNotIndexed += 1; return;
    case 'quality_or_uniqueness':
      b.crawledNotIndexed += 1; return;
    case 'canonical_consolidation':
      b.alternateCanonical += 1; return;
    case 'duplicate_no_signal':
      b.duplicateNoCanonical += 1; return;
    case 'noindex_directive':
      b.excludedNoindex += 1; return;
    case 'redirect':
      b.redirect += 1; return;
    case 'robots_txt_blocked':
      b.blockedByRobots += 1; return;
    case 'server_error':
      b.serverError += 1; return;
    case 'soft_404':
      b.soft404 += 1; return;
    default:
      b.other += 1; return;
  }
}

function summarizeByRouteType(rows: GscReconciledUrlRow[]): GscRouteTypeSummary[] {
  const map = new Map<GscRouteType, GscRouteTypeSummary>();
  for (const r of rows) {
    const key = r.routeType;
    if (!map.has(key)) {
      map.set(key, {
        routeType: key,
        totalSeen: 0,
        status: emptyStatusBreakdown(),
        impressions: 0,
        clicks: 0,
      });
    }
    const slot = map.get(key)!;
    slot.totalSeen += 1;
    slot.impressions += r.impressions ?? 0;
    slot.clicks += r.clicks ?? 0;
    bumpStatus(slot.status, r);
  }
  return Array.from(map.values()).sort((a, b) => b.totalSeen - a.totalSeen);
}

function summarizeByTier(rows: GscReconciledUrlRow[]): GscTierSummary[] {
  const tiers: ZipPriorityTier[] = [1, 2, 3];
  return tiers.map((tier) => {
    const subset = rows.filter((r) => r.zipPriorityTier === tier);
    return {
      tier,
      totalSeen: subset.length,
      indexed: subset.filter((r) => r.indexingStatus && isIndexedStatus(r.indexingStatus)).length,
      notIndexed: subset.filter((r) => r.indexingStatus && !isIndexedStatus(r.indexingStatus)).length,
      impressions: subset.reduce((acc, r) => acc + (r.impressions ?? 0), 0),
      clicks: subset.reduce((acc, r) => acc + (r.clicks ?? 0), 0),
    };
  });
}

function summarizeByShard(rows: GscReconciledUrlRow[]): GscShardSummary[] {
  const manifest = listShardManifest();
  const shardCounts = new Map<string, { totalSeen: number; indexed: number; notIndexed: number; impressions: number; clicks: number }>();
  for (const m of manifest) shardCounts.set(m.url, { totalSeen: 0, indexed: 0, notIndexed: 0, impressions: 0, clicks: 0 });
  for (const r of rows) {
    if (!r.sitemapShard) continue;
    const slot = shardCounts.get(r.sitemapShard);
    if (!slot) continue;
    slot.totalSeen += 1;
    if (r.indexingStatus) {
      if (isIndexedStatus(r.indexingStatus)) slot.indexed += 1;
      else slot.notIndexed += 1;
    }
    slot.impressions += r.impressions ?? 0;
    slot.clicks += r.clicks ?? 0;
  }
  return manifest.map((m) => {
    const counts = shardCounts.get(m.url)!;
    return {
      sitemapUrl: m.url,
      label: m.label,
      urlsInShard: 0, // populated in admin endpoint via seo-health snapshot
      seenInGsc: counts.totalSeen,
      indexed: counts.indexed,
      notIndexed: counts.notIndexed,
      impressions: counts.impressions,
      clicks: counts.clicks,
    };
  });
}

// ── Queues ───────────────────────────────────────────────────────────

const QUEUE_DEFS: Array<Omit<GscRecommendationQueue, 'items'> & { match: (r: GscReconciledUrlRow) => boolean }> = [
  {
    id: 'tier1_not_indexed',
    title: 'Tier-1 ZIPs not indexed',
    description: 'Manually-designated priority ZIPs and ZIPs in curated city hubs that GSC reports as not indexed.',
    recommendedActions: [
      'Strengthen internal links from hubs.',
      'Inspect URL in Search Console.',
      'Verify canonical + sitemap shard inclusion.',
    ],
    match: (r) => r.routeType === 'zip_page' && r.zipPriorityTier === 1 && !!r.indexingStatus && !isIndexedStatus(r.indexingStatus),
  },
  {
    id: 'tier1_impressions_low_ctr',
    title: 'Tier-1 ZIPs with impressions but low CTR',
    description: 'Tier-1 ZIPs that GSC says are earning impressions but converting poorly.',
    recommendedActions: [
      'Improve title and meta description.',
      'Consider a custom intro on the ZIP page.',
      'Surface the ZIP more prominently on its city/state hub.',
    ],
    match: (r) => r.routeType === 'zip_page' && r.zipPriorityTier === 1 && (r.impressions ?? 0) >= 25 && (r.ctr ?? 0) < LOW_CTR_THRESHOLD,
  },
  {
    id: 'city_hubs_low_impressions',
    title: 'City hubs with low or no impressions',
    description: 'City hubs that exist in code but are not earning visibility.',
    recommendedActions: [
      'Strengthen homepage and state hub links pointing here.',
      'Improve hub copy.',
      'Add more featured ZIP forecasts.',
    ],
    match: (r) => r.routeType === 'city_hub' && (r.impressions ?? 0) < 25,
  },
  {
    id: 'state_hubs_no_indexed_children',
    title: 'State hubs not indexed',
    description: 'State hubs that GSC reports as not indexed (blocks crawl into the state\'s ZIP shard).',
    recommendedActions: [
      'Inspect the state\'s sitemap shard.',
      'Strengthen city links from the state hub.',
      'Verify ZIP crawl paths.',
    ],
    match: (r) => r.routeType === 'state_hub' && !!r.indexingStatus && !isIndexedStatus(r.indexingStatus),
  },
  {
    id: 'discovered_not_indexed_strategic',
    title: 'Discovered — currently not indexed (strategic)',
    description: 'Tier-1/Tier-2 ZIPs and hubs that GSC discovered but has not yet indexed.',
    recommendedActions: [
      'Add stronger internal links from hubs.',
      'Promote to the featured set.',
      'Inspect the parent sitemap shard.',
    ],
    match: (r) => r.notIndexedReason === 'crawl_budget_or_priority' && (
      r.routeType === 'state_hub' || r.routeType === 'city_hub' ||
      (r.routeType === 'zip_page' && (r.zipPriorityTier === 1 || r.zipPriorityTier === 2))
    ),
  },
  {
    id: 'crawled_not_indexed',
    title: 'Crawled — currently not indexed',
    description: 'GSC sees these pages but does not consider them index-worthy.',
    recommendedActions: [
      'Improve uniqueness / usefulness of the page.',
      'Add supporting hub links.',
      'Monitor the next recrawl.',
    ],
    match: (r) => r.notIndexedReason === 'quality_or_uniqueness',
  },
  {
    id: 'alternate_canonical_or_duplicate_host',
    title: 'Alternate canonical or duplicate host',
    description: 'Legacy www URLs and alternate-canonical findings that should consolidate after recrawl.',
    recommendedActions: [
      'Confirm the www → non-www 301 is firing.',
      'Confirm the page emits the non-www canonical.',
      'Monitor recrawl over 30–60 days.',
    ],
    match: (r) => r.notIndexedReason === 'canonical_consolidation' || r.notIndexedReason === 'duplicate_no_signal' ||
      (r.canonicalUrl.startsWith(WWW_HOST) && !isInternalCanonicalUrl(r.canonicalUrl)),
  },
  {
    id: 'noindex_expected',
    title: 'Noindex expected',
    description: 'Admin / private / auth / dashboard surfaces correctly flagged by GSC as excluded.',
    recommendedActions: [
      'No action unless a public page is incorrectly listed here.',
    ],
    match: (r) => r.routeType === 'noindex_admin' || r.routeType === 'noindex_auth' || r.routeType === 'noindex_other' || r.notIndexedReason === 'noindex_directive',
  },
  {
    id: 'promote_candidates',
    title: 'Tier-2/3 ZIPs with impressions or clicks',
    description: 'Long-tail ZIPs that are earning interest. Consider promoting to the priority list or featured blocks.',
    recommendedActions: [
      'Promote to the priority ZIP list.',
      'Add a custom intro paragraph.',
      'Feature on the city hub.',
    ],
    match: (r) => r.routeType === 'zip_page' &&
      (r.zipPriorityTier === 2 || r.zipPriorityTier === 3) &&
      ((r.impressions ?? 0) > 0 || (r.clicks ?? 0) > 0),
  },
  {
    id: 'deprioritize_candidates',
    title: 'Long-tail ZIPs with no impressions',
    description: 'Tier-3 ZIPs that have been discovered/crawled but are not earning any GSC visibility.',
    recommendedActions: [
      'Consider moving to the consolidate_candidate band.',
      'Avoid spending more internal-linking budget here.',
    ],
    match: (r) => r.routeType === 'zip_page' && r.zipPriorityTier === 3 &&
      (r.impressions ?? 0) === 0 && (r.clicks ?? 0) === 0 &&
      !!r.indexingStatus && !isIndexedStatus(r.indexingStatus),
  },
];

export function buildGscQueues(rows: GscReconciledUrlRow[]): GscRecommendationQueue[] {
  return QUEUE_DEFS.map((def) => {
    const matches = rows.filter(def.match);
    matches.sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));
    const items: GscRecommendationQueueItem[] = matches.slice(0, MAX_QUEUE_ITEMS).map((r) => ({
      canonicalUrl: r.canonicalUrl,
      pathname: r.pathname,
      routeType: r.routeType,
      zipPriorityTier: r.zipPriorityTier,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      averagePosition: r.averagePosition,
      indexingStatus: r.indexingStatus,
      notIndexedReason: r.notIndexedReason,
      reasons: r.reasons,
    }));
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      recommendedActions: def.recommendedActions,
      items,
    };
  });
}

// ── Public entry: parse-and-reconcile ─────────────────────────────────

export function buildGscReconciliationReport(input: {
  indexingCsv: string;
  performanceCsv: string;
}): GscReconciliationReport {
  const ind = parseGscIndexingCsv(input.indexingCsv ?? '');
  const perf = parseGscPerformanceCsv(input.performanceCsv ?? '');
  return reconcileGscRows(ind.rows, perf.rows, [...ind.warnings, ...perf.warnings]);
}

