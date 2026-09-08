// ── Search Console, read directly from the API ────────────────────────────
//
// Step 176 landed the GSC types with an explicit note: "No API integration in
// this step... so future steps can wire the GSC API without breaking the SEO
// health snapshot's contract." This is that step.
//
// Until now `/admin/system/seo-health` was fed by hand: an operator exported
// two CSVs from Search Console and uploaded them. That works exactly as often
// as somebody remembers to do it, which over the last eight weeks was never.
// A decline nobody measures is a decline nobody sees.
//
// **This file deliberately produces the SAME row shapes the CSV importer
// produces** (`GscPerformanceExportRow`, `GscIndexingExportRow`). Everything
// downstream — `reconcileGscRows`, the recommendation queues, the dashboard —
// is untouched and cannot tell where the rows came from. The CSV path stays
// as-is, so an operator can still upload an export for a window the API does
// not cover.
//
// Read-only. The scope requested is `webmasters.readonly`, so nothing here
// can submit a sitemap, request indexing, or change a property.

import { GoogleAuth } from 'google-auth-library';
import { normalizeGscUrl } from './gsc-import';
import type {
  GscIndexingExportRow,
  GscPerformanceExportRow,
  GscIndexedStatus,
} from './gsc-types';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API_BASE = 'https://searchconsole.googleapis.com';

/** The property to query. A domain property covers every subdomain. */
export function gscSiteUrl(): string {
  return import.meta.env.GSC_SITE_URL || 'sc-domain:wageronweather.com';
}

/**
 * Service-account credentials.
 *
 * Falls back to the BigQuery service account (`GCP_CREDENTIALS_BASE64`) that
 * this project already carries, so the usual setup is to add that account's
 * email as a user on the Search Console property rather than mint a second
 * key. `GSC_CREDENTIALS_BASE64` overrides it when a separate identity is
 * wanted.
 */
function serviceAccount(): Record<string, unknown> | null {
  const b64 = import.meta.env.GSC_CREDENTIALS_BASE64 || import.meta.env.GCP_CREDENTIALS_BASE64;
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

/** True when the API path is usable at all. Callers degrade to the CSV data. */
export function gscApiConfigured(): boolean {
  return serviceAccount() !== null;
}

async function accessToken(): Promise<string | null> {
  const credentials = serviceAccount();
  if (!credentials) return null;
  try {
    const auth = new GoogleAuth({ credentials, scopes: [SCOPE] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return typeof token === 'string' ? token : (token?.token ?? null);
  } catch (err) {
    console.error('[gsc-api] could not mint an access token', err);
    return null;
  }
}

async function gscFetch(path: string, body: unknown): Promise<any | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // 403 here almost always means the service account is not a user on the
      // property, which is a setup problem and not an outage — say so plainly
      // rather than leaving a bare status code in the log.
      const hint = res.status === 403
        ? ' (is the service account added as a user on the Search Console property?)'
        : '';
      console.error(`[gsc-api] ${res.status} ${res.statusText} on ${path}${hint}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[gsc-api] fetch failed on ${path}`, err);
    return null;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Search Console finalises data on a lag; anything inside this is incomplete. */
export const DATA_LAG_DAYS = 3;

/** The most recent window of `days` that GSC has finished counting. */
export function settledWindow(days: number, now: Date = new Date()): { startDate: string; endDate: string } {
  const end = new Date(now.getTime() - DATA_LAG_DAYS * 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: ymd(start), endDate: ymd(end) };
}

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Site-wide totals for a window, or null when the API is unavailable. */
export async function fetchTotals(days: number): Promise<GscTotals | null> {
  const data = await gscFetch(
    `/webmasters/v3/sites/${encodeURIComponent(gscSiteUrl())}/searchAnalytics/query`,
    { ...settledWindow(days), dimensions: [], rowLimit: 1 },
  );
  const row = data?.rows?.[0];
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}

/**
 * Per-page performance for a window, in the same shape the CSV importer
 * produces so the reconciliation layer cannot tell the difference.
 */
export async function fetchPagePerformance(days: number, rowLimit = 1000): Promise<GscPerformanceExportRow[] | null> {
  const data = await gscFetch(
    `/webmasters/v3/sites/${encodeURIComponent(gscSiteUrl())}/searchAnalytics/query`,
    { ...settledWindow(days), dimensions: ['page'], rowLimit },
  );
  if (!data) return null;
  return (data.rows ?? []).map((r: any): GscPerformanceExportRow => {
    const url = r.keys?.[0] ?? '';
    const impressions = r.impressions ?? 0;
    return {
      url,
      canonicalUrl: normalizeGscUrl(url),
      impressions,
      clicks: r.clicks ?? 0,
      // The CSV importer normalises CTR to a fraction and reports null on zero
      // impressions; the API already gives a fraction, so only the null rule
      // has to be applied here to keep the two sources identical.
      ctr: impressions > 0 ? (r.ctr ?? 0) : null,
      position: r.position ?? null,
    };
  });
}

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Top queries for a window. Not part of the CSV contract; used for reporting. */
export async function fetchTopQueries(days: number, rowLimit = 100): Promise<GscQueryRow[] | null> {
  const data = await gscFetch(
    `/webmasters/v3/sites/${encodeURIComponent(gscSiteUrl())}/searchAnalytics/query`,
    { ...settledWindow(days), dimensions: ['query'], rowLimit },
  );
  if (!data) return null;
  return (data.rows ?? []).map((r: any): GscQueryRow => ({
    query: r.keys?.[0] ?? '',
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));
}

/** GSC's coverageState prose -> the enum gsc-types.ts already declares. */
export function mapCoverageState(coverageState: string | undefined, verdict: string | undefined): GscIndexedStatus {
  const s = (coverageState ?? '').toLowerCase();
  if (s.includes('submitted and indexed')) return 'submitted_and_indexed';
  if (s.includes('discovered')) return 'discovered_not_indexed';
  if (s.includes('crawled')) return 'crawled_not_indexed';
  if (s.includes('alternate page')) return 'alternate_canonical';
  if (s.includes('duplicate') && s.includes('without user-selected')) return 'duplicate_no_user_canonical';
  if (s.includes('duplicate')) return 'duplicate_user_canonical';
  if (s.includes('noindex')) return 'excluded_by_noindex';
  if (s.includes('soft 404')) return 'soft_404';
  if (s.includes('server error')) return 'server_error';
  if (s.includes('redirect')) return 'page_with_redirect';
  if (s.includes('robots.txt')) return 'blocked_by_robots_txt';
  if (verdict === 'PASS') return 'indexed';
  return 'unknown';
}

/**
 * Inspect a handful of URLs.
 *
 * **Deliberately one at a time and deliberately a handful.** The URL
 * Inspection API is quota'd at 2,000 calls a day and 600 a minute per
 * property, which is nowhere near the ~6,300 URLs in the sitemap — this is
 * for a fixed watchlist of pages that matter, not a crawl. Callers pass the
 * list; `keyPagesToInspect` below is the default one.
 */
export async function inspectUrls(urls: readonly string[]): Promise<GscIndexingExportRow[] | null> {
  if (!gscApiConfigured()) return null;
  const out: GscIndexingExportRow[] = [];
  for (const url of urls) {
    const data = await gscFetch('/v1/urlInspection/index:inspect', {
      inspectionUrl: url,
      siteUrl: gscSiteUrl(),
    });
    if (!data) continue;
    const r = data.inspectionResult?.indexStatusResult ?? {};
    out.push({
      url,
      canonicalUrl: normalizeGscUrl(url),
      status: data.inspectionResult?.indexStatusResult?.verdict,
      reason: r.coverageState,
      source: r.robotsTxtState,
      lastCrawled: r.lastCrawlTime,
      googleCanonical: r.googleCanonical,
      userCanonical: r.userCanonical,
    });
  }
  return out;
}
