// ── Step 118: Kalshi market-data service (server-only) ──────────────────────
//
// Owns the read-only snapshot lifecycle: fetch from Kalshi, normalize into
// the public-safe internal shape, persist to Redis, and list/retrieve
// stored snapshots. This is the only module that should call the Kalshi
// client from the admin route — keeps the route handler thin.
//
// Safety:
// - Server-only.
// - Read-only by construction; no order endpoints; no automatic mirroring.
// - Snapshots and the audit trail are the only writes performed.

import { getRedis } from './redis';
import { getKalshiConfig, type KalshiEnv } from './kalshi-config';
import {
  listMarkets,
  listSeries,
  type KalshiMarketRaw,
  type ListMarketsParams,
} from './kalshi-client';

if (typeof window !== 'undefined') {
  throw new Error(
    'kalshi-market-data is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface KalshiMarketSummary {
  ticker: string;
  title?: string;
  category?: string;
  status?: string;
  closeTime?: string;
  yesBid?: number;
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  rawPublicSummary?: Record<string, unknown>;
}

export interface KalshiMarketSnapshot {
  id: string;
  createdAt: string;
  createdBy: string;
  kalshiEnv: KalshiEnv;
  query: ListMarketsParams;
  markets: KalshiMarketSummary[];
  warnings: string[];
  status: 'read_only_snapshot';
  /** Marks the snapshot kind so downstream consumers (daily brief, etc.)
   *  can find e.g. the most recent climate snapshot without re-scanning
   *  every market's ticker. Optional for backward compatibility with
   *  snapshots stored before this field existed. */
  kind?: 'general' | 'climate';
}

export class KalshiMarketDataError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  snapshot: (id: string) => `kalshi-market-snapshot:${id}`,
  all: 'kalshi-market-snapshots:all',
  listCache: (hash: string) => `kalshi-list-cache:${hash}`,
};
const MAX_SNAPSHOTS = 200;
const LIST_CACHE_TTL_SECONDS = 60;

// ── Query cache (Step 118 follow-up) ────────────────────────────────────────
//
// Short-lived Redis cache keyed by a stable hash of the normalized query.
// Purpose is to cushion accidental double-clicks and burst quota use; it
// does NOT replace snapshot persistence. Each fetchAndStoreMarketSnapshot
// call still writes its own snapshot. Cache holds raw market data only —
// no credentials, no headers, no signed values.

function normalizeQueryForHash(q: ListMarketsParams): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(q).sort()) {
    const v = (q as any)[k];
    if (v === undefined || v === null || v === '') continue;
    sorted[k] = v;
  }
  return JSON.stringify(sorted);
}

function hashQuery(q: ListMarketsParams): string {
  // Small djb2-style hash; collisions are tolerable because the cache TTL
  // is 60 seconds and the worst-case effect is a stale list.
  const s = normalizeQueryForHash(q);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

async function cachedListMarkets(
  q: ListMarketsParams,
): Promise<{ markets: KalshiMarketRaw[]; cached: boolean }> {
  const redis = getRedis();
  const cacheKey = KEY.listCache(hashQuery(q));
  // Upstash auto-deserializes JSON values — handle both string (rare)
  // and already-parsed object (default) so the cache actually hits.
  const cached = await redis.get(cacheKey);
  if (cached != null) {
    try {
      let parsed: { markets?: KalshiMarketRaw[] } | null = null;
      if (typeof cached === 'string') {
        parsed = JSON.parse(cached);
      } else if (typeof cached === 'object') {
        parsed = cached as { markets?: KalshiMarketRaw[] };
      }
      if (parsed && Array.isArray(parsed.markets)) {
        return { markets: parsed.markets, cached: true };
      }
    } catch {
      /* fall through to fresh fetch */
    }
  }
  const res = await listMarkets(q);
  if (!res.ok) {
    throw new KalshiMarketDataError(
      res.errorMessage ?? `Kalshi listMarkets failed (status ${res.status})`,
      'kalshi_request_failed',
    );
  }
  const markets = res.data?.markets ?? [];
  try {
    await redis.set(cacheKey, JSON.stringify({ markets }), { ex: LIST_CACHE_TTL_SECONDS });
  } catch {
    /* cache failures are non-fatal */
  }
  return { markets, cached: false };
}

// ── Normalization ───────────────────────────────────────────────────────────

function pickPublicSummary(m: KalshiMarketRaw): Record<string, unknown> {
  // Whitelist of fields safe to surface to admins. Excludes any internal
  // operator/account fields the API might add later. Defensive against
  // upstream additions — never spread the raw record.
  const out: Record<string, unknown> = {};
  for (const k of [
    'ticker',
    'event_ticker',
    'series_ticker',
    'title',
    'subtitle',
    'category',
    'status',
    'close_time',
    'open_time',
    'expiration_time',
    'rules_primary',
    'yes_bid',
    'yes_ask',
    'no_bid',
    'no_ask',
    'last_price',
    'volume',
    'volume_24h',
    'open_interest',
    'liquidity',
  ]) {
    if (m[k] !== undefined) out[k] = m[k];
  }
  return out;
}

function normalizeMarket(m: KalshiMarketRaw): KalshiMarketSummary {
  return {
    ticker: m.ticker,
    title: m.title,
    category: m.category,
    status: m.status,
    closeTime: m.close_time,
    yesBid: m.yes_bid,
    yesAsk: m.yes_ask,
    noBid: m.no_bid,
    noAsk: m.no_ask,
    lastPrice: m.last_price,
    volume: m.volume,
    openInterest: m.open_interest,
    rawPublicSummary: pickPublicSummary(m),
  };
}

// ── Snapshot lifecycle ──────────────────────────────────────────────────────

function newSnapshotId(): string {
  return `kms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run an async function over a list with bounded concurrency. Used by
 * the climate fetcher to probe Kalshi series tickers without firing 70+
 * simultaneous requests (which triggered 429 too_many_requests errors
 * in practice). Results are returned in the same order as the input.
 */
async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Render any unknown error value as a short readable string. */
function stringifyError(err: unknown): string {
  if (!err) return 'unknown_error';
  if (typeof err === 'string') return err.slice(0, 240);
  if (err instanceof Error) return err.message.slice(0, 240);
  if (typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown };
    if (typeof e.message === 'string') return e.message.slice(0, 240);
    if (typeof e.code === 'string') return e.code;
    try {
      return JSON.stringify(err).slice(0, 240);
    } catch {
      return 'unknown_error_object';
    }
  }
  return String(err).slice(0, 240);
}

export async function fetchAndStoreMarketSnapshot(
  query: ListMarketsParams,
  createdBy: string,
): Promise<KalshiMarketSnapshot> {
  const cfg = getKalshiConfig();
  const warnings: string[] = [];

  if (!cfg.apiKeyId || !cfg.privateKeyPresent) {
    throw new KalshiMarketDataError(
      'Kalshi credentials are not configured. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_BASE64.',
      'credentials_missing',
    );
  }
  if (!cfg.readOnly) {
    warnings.push(
      'KALSHI_READ_ONLY is disabled; this snapshot only reads, but the global guard is off.',
    );
  }

  const { markets: rawMarkets, cached } = await cachedListMarkets(query);
  if (cached) {
    warnings.push(
      'Markets served from 60-second list cache; click again after a minute to force a fresh fetch.',
    );
  }
  const markets = rawMarkets.map(normalizeMarket);

  const snapshot: KalshiMarketSnapshot = {
    id: newSnapshotId(),
    createdAt: new Date().toISOString(),
    createdBy,
    kalshiEnv: cfg.env,
    query,
    markets,
    warnings,
    status: 'read_only_snapshot',
  };

  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.snapshot(snapshot.id), JSON.stringify(snapshot));
  pipe.zadd(KEY.all, {
    score: Date.parse(snapshot.createdAt),
    member: snapshot.id,
  });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_SNAPSHOTS - 1);
  await pipe.exec();

  return snapshot;
}

// ── Climate-scoped snapshot ─────────────────────────────────────────────────
//
// Kalshi's weather/climate markets live in per-city series tickers
// (`KXHIGHDEN`, `KXHIGHNYC`, `KXLOWDEN`, …). The `series_ticker` filter
// is exact-match, so we probe each likely city code in parallel and
// aggregate whatever is open. This is the right approach because
// `q=temperature` was discovered to be dominated by sports markets
// (KXMVE* tickers) whose internal metadata mentions "temperature" but
// which are not climate markets at all.
//
// Verified series tickers (May 2026):
//   - `KXHIGHDEN` — Highest temperature in Denver (operator-confirmed
//     via market URL https://kalshi.com/markets/kxhighden/...).
//
// Other city codes are reasonable guesses based on IATA-style airport
// codes + the cities visible on Kalshi's Climate category page. Series
// that don't exist return empty responses cleanly — no error.

/** Candidate city codes for `KXHIGH{code}` / `KXLOW{code}` series. */
const KALSHI_WEATHER_CITY_CODES: ReadonlyArray<string> = [
  'DEN',                // confirmed
  'NY', 'NYC',
  'SF', 'SFO',
  'SEA',
  'PHX',
  'CHI', 'ORD',
  'LA', 'LAX',
  'BOS',
  'DAL', 'DFW',
  'ATL',
  'LAS',
  'AUS',
  'MIA',
  'HOU', 'IAH',
  'DC', 'DCA',
  'PHI', 'PHL',
  'DTW', 'DET',
  'MSP', 'MIN',
  'STP',
  'OKC',
  'PDX', 'POR',
  'SMF', 'SAC',
  'SLC',
  'HNL',
  'MSY', 'NOL',
];

/** Series-name prefixes used to classify climate markets client-side.
 *  Expanded May 2026 to cover rain / snow / hurricane / earthquake /
 *  El Niño / wind alongside temperature. Add more here if Kalshi
 *  introduces new climate series. */
const KALSHI_WEATHER_TICKER_PREFIXES: ReadonlyArray<string> = [
  'KXHIGH',   // Highest temperature in {city}
  'KXLOW',    // Lowest temperature in {city}
  'KXTEMP',   // Generic temperature (placeholder for future series)
  'KXRAIN',   // Rain in {city} markets
  'KXSNOW',   // Snowfall markets
  'KXWIND',   // Wind / gust markets
  'KXHURR',   // Hurricane markets
  'KXSTORM',  // Tropical storm markets
  'KXEARTH',  // Earthquake markets
  'KXENSO',   // El Niño / La Niña markets
  'KXCLIM',   // Generic climate placeholder
];

/** Max pages of /markets pagination we'll walk when bulk-fetching. */
const KALSHI_CLIMATE_MAX_PAGES = 20;

/** Per-page limit when bulk-fetching open markets. Kalshi caps at 1000. */
const KALSHI_CLIMATE_PAGE_LIMIT = 1000;

/**
 * Snapshot dedicated to climate markets. Probes every
 * `KXHIGH{code}` / `KXLOW{code}` candidate series in parallel,
 * aggregates open markets, and stores them as a single snapshot.
 *
 * Returns the same shape as `fetchAndStoreMarketSnapshot`. Adds
 * diagnostic warnings when the aggregate is empty so we can see which
 * candidate codes were probed.
 */
export async function fetchAndStoreClimateMarketSnapshot(
  createdBy: string,
): Promise<KalshiMarketSnapshot> {
  const cfg = getKalshiConfig();
  const warnings: string[] = [];

  if (!cfg.apiKeyId || !cfg.privateKeyPresent) {
    throw new KalshiMarketDataError(
      'Kalshi credentials are not configured. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_BASE64.',
      'credentials_missing',
    );
  }
  if (!cfg.readOnly) {
    warnings.push(
      'KALSHI_READ_ONLY is disabled; this snapshot only reads, but the global guard is off.',
    );
  }

  // Strategy (revised May 2026): bulk pagination over all open
  // markets failed because Kalshi's default ordering puts thousands of
  // sports markets ahead of any climate market, and Kalshi 429s on
  // long sequential scans before we ever reach climate inventory.
  // Back to per-series probing — but with much more conservative
  // settings:
  //   - paginated /series discovery (catches series past the first
  //     1000 if Kalshi has that many)
  //   - probe concurrency 2 (was 5)
  //   - single retry on 429 with 1.2s backoff per series
  //   - belt-and-suspenders hardcoded city codes

  // 1. Discover every weather series via /series, paginated.
  const discovered = new Set<string>();
  let listSeriesError: string | null = null;
  try {
    let seriesCursor: string | undefined = undefined;
    for (let page = 0; page < 10; page++) {
      const resp = await listSeries({ limit: 1000, cursor: seriesCursor });
      if (!resp.ok) {
        listSeriesError = `status=${resp.status}: ${stringifyError(resp.errorMessage)}`;
        break;
      }
      const items = resp.data?.series ?? [];
      for (const s of items) {
        if (
          typeof s.ticker === 'string' &&
          KALSHI_WEATHER_TICKER_PREFIXES.some((p) => s.ticker.startsWith(p))
        ) {
          discovered.add(s.ticker);
        }
      }
      const nextCursor = resp.data?.cursor;
      if (!nextCursor || nextCursor === seriesCursor) break;
      seriesCursor = nextCursor;
    }
  } catch (err) {
    listSeriesError = stringifyError(err);
  }

  // 2. Add hardcoded city codes (belt-and-suspenders).
  for (const code of KALSHI_WEATHER_CITY_CODES) {
    discovered.add(`KXHIGH${code}`);
    discovered.add(`KXLOW${code}`);
  }

  const seriesTickers: string[] = Array.from(discovered).sort();

  // 3. Probe each series with bounded concurrency 2 + retry on 429.
  const PROBE_CONCURRENCY = 2;
  const RETRY_BACKOFF_MS = 1200;

  async function probeSeries(st: string): Promise<{
    st: string;
    markets: KalshiMarketRaw[];
    cached: boolean;
    error: string | null;
    retried: boolean;
  }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { markets, cached } = await cachedListMarkets({
          series_ticker: st,
          status: 'open',
          limit: 100,
        });
        return { st, markets, cached, error: null, retried: attempt > 0 };
      } catch (err) {
        const msg = stringifyError(err);
        const is429 = /429|too_many_requests/i.test(msg);
        if (is429 && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
          continue;
        }
        return {
          st,
          markets: [] as KalshiMarketRaw[],
          cached: false,
          error: msg,
          retried: attempt > 0,
        };
      }
    }
    return {
      st,
      markets: [] as KalshiMarketRaw[],
      cached: false,
      error: 'unknown_error_after_retry',
      retried: true,
    };
  }

  const responses = await runWithConcurrency(
    seriesTickers,
    PROBE_CONCURRENCY,
    probeSeries,
  );

  // 4. Aggregate.
  const allMarkets: KalshiMarketRaw[] = [];
  const seriesWithData: string[] = [];
  const errored: string[] = [];
  let anyCacheHit = false;
  let retryCount = 0;
  for (const r of responses) {
    if (r.retried) retryCount += 1;
    if (r.error) {
      errored.push(`${r.st}: ${r.error}`);
      continue;
    }
    if (r.cached) anyCacheHit = true;
    if (r.markets.length > 0) {
      allMarkets.push(...r.markets);
      seriesWithData.push(`${r.st} (${r.markets.length})`);
    }
  }

  // 5. Belt-and-suspenders ticker-prefix filter on the aggregated set.
  const climateRaw = allMarkets.filter(
    (m) =>
      typeof m.ticker === 'string' &&
      KALSHI_WEATHER_TICKER_PREFIXES.some((p) => m.ticker.startsWith(p)),
  );

  // Per-prefix counts for diagnostics.
  const perPrefixCounts = new Map<string, number>();
  for (const m of climateRaw) {
    if (typeof m.ticker !== 'string') continue;
    const prefix = KALSHI_WEATHER_TICKER_PREFIXES.find((p) => m.ticker.startsWith(p));
    if (prefix) perPrefixCounts.set(prefix, (perPrefixCounts.get(prefix) ?? 0) + 1);
  }

  // 6. Diagnostic warnings.
  warnings.push(
    `Probed ${seriesTickers.length} series tickers via /series + hardcoded fallback. Filter prefixes: [${KALSHI_WEATHER_TICKER_PREFIXES.join(', ')}]. Returned ${climateRaw.length} open markets across ${seriesWithData.length} series.`,
  );
  if (listSeriesError) {
    warnings.push(`/series discovery error (${listSeriesError}). Falling back to hardcoded list only.`);
  }
  if (perPrefixCounts.size > 0) {
    const summary = Array.from(perPrefixCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} (${v})`)
      .join(', ');
    warnings.push(`Climate markets by prefix: ${summary}`);
  }
  if (seriesWithData.length > 0) {
    warnings.push(
      `Series with open markets (${seriesWithData.length}): ${seriesWithData.slice(0, 30).join(', ')}${seriesWithData.length > 30 ? '…' : ''}`,
    );
  }
  if (errored.length > 0) {
    warnings.push(
      `${errored.length} series probe(s) failed: ${errored.slice(0, 5).join(' | ')}${errored.length > 5 ? '…' : ''}`,
    );
  }
  if (retryCount > 0) {
    warnings.push(`Retried ${retryCount} series after 429 rate-limit responses.`);
  }
  if (anyCacheHit) {
    warnings.push('Some series served from 60s list cache — click again after a minute for fresh data.');
  }
  if (climateRaw.length === 0) {
    warnings.push(
      'No climate markets returned. Either no weather markets are open on Kalshi right now, or all series probes errored. Check the per-series error list above.',
    );
  }

  // Sort: actively-quoted markets first, then by volume desc, then by
  // ticker asc. Without this, illiquid markets (earthquake series with
  // no current bids/asks but alphabetically-early tickers) crowd out
  // the temperature/precipitation markets that operators actually want
  // to see. Sorting here ensures both the admin table and the daily
  // brief get the useful ordering.
  const normalized = climateRaw.map(normalizeMarket);
  normalized.sort((a, b) => {
    const aQuoted = a.yesAsk != null || a.noAsk != null ? 1 : 0;
    const bQuoted = b.yesAsk != null || b.noAsk != null ? 1 : 0;
    if (aQuoted !== bQuoted) return bQuoted - aQuoted;
    const av = a.volume ?? 0;
    const bv = b.volume ?? 0;
    if (bv !== av) return bv - av;
    return (a.ticker ?? '').localeCompare(b.ticker ?? '');
  });
  const markets = normalized;

  // Diagnostic: count how many markets have active quotes vs not.
  const quotedCount = markets.filter((m) => m.yesAsk != null || m.noAsk != null).length;
  warnings.push(
    `${quotedCount} of ${markets.length} markets have active bid/ask quotes; remaining markets are listed but show — for odds (no current orders).`,
  );

  // Deeper diagnostic for when quotedCount === 0: dump the raw field
  // names + types from a sample of climate markets so we can spot
  // whether Kalshi has renamed yes_ask / yes_bid / etc. The sample
  // pulls 3 climate markets directly from the raw API response (not
  // the normalized form) so we see what Kalshi actually sent.
  if (quotedCount === 0 && climateRaw.length > 0) {
    const sampleSize = Math.min(3, climateRaw.length);
    const fieldDumps: string[] = [];
    for (let i = 0; i < sampleSize; i++) {
      const m = climateRaw[i];
      const ticker = typeof m.ticker === 'string' ? m.ticker : 'unknown';
      const keys = Object.keys(m);
      const priceFields: string[] = [];
      for (const k of keys) {
        if (/yes|no|bid|ask|price|cents|odds|last|liquidity|vol|interest/i.test(k)) {
          const v = (m as any)[k];
          const valStr = v == null ? 'null' : typeof v === 'object' ? 'object' : String(v).slice(0, 32);
          priceFields.push(`${k}=${valStr}`);
        }
      }
      fieldDumps.push(`${ticker}: ${priceFields.length > 0 ? priceFields.join(', ') : 'no price-like fields found'}`);
    }
    warnings.push(`Raw-field diagnostic (sampled ${sampleSize} markets): ${fieldDumps.join(' | ')}`);
    // Also dump ALL distinct top-level keys seen on the first market.
    if (climateRaw[0]) {
      const allKeys = Object.keys(climateRaw[0]).sort();
      warnings.push(`First market top-level keys (${allKeys.length}): ${allKeys.join(', ')}`);
    }
  }

  // Stored query reflects the strategy used, for traceability.
  const query: ListMarketsParams = {
    status: 'open',
    limit: 100,
    // No series_ticker: this snapshot aggregates many series probed
    // individually. Per-series counts surfaced in warnings.
  };

  const snapshot: KalshiMarketSnapshot = {
    id: newSnapshotId(),
    createdAt: new Date().toISOString(),
    createdBy,
    kalshiEnv: cfg.env,
    query,
    markets,
    warnings,
    status: 'read_only_snapshot',
    kind: 'climate',
  };

  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.snapshot(snapshot.id), JSON.stringify(snapshot));
  pipe.zadd(KEY.all, {
    score: Date.parse(snapshot.createdAt),
    member: snapshot.id,
  });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_SNAPSHOTS - 1);
  await pipe.exec();

  return snapshot;
}

export interface ClimateSnapshotDiagnostic {
  scanned: number;
  matchedByKind: number;
  matchedByTickerPrefix: number;
  recentKinds: Array<string | null>;
  recentMarketCounts: number[];
  /** First 5 sample ticker prefixes across the scanned snapshots. */
  recentTickerPrefixes: string[];
  resolvedVia: 'kind_tag' | 'ticker_prefix_fallback' | null;
}

/**
 * Returns the most recent climate-kind snapshot or `null` if none
 * exists. Scans the most recent `scanLimit` snapshots in descending
 * time order; bounded so the daily brief never pays unbounded I/O.
 *
 * Two-pass:
 *   1. Snapshots explicitly tagged `kind: 'climate'` win.
 *   2. Fall back to snapshots whose markets *all* have ticker prefixes
 *      `KXHIGH` or `KXLOW` — climate-shaped snapshots captured before
 *      the `kind` field existed. Keeps the brief populated through the
 *      first deploy transition without requiring operators to
 *      re-fetch.
 *
 * When `withDiagnostic` is true, returns an object describing what
 * was scanned and how it was resolved. Used by the daily brief so
 * operators can see why a snapshot was or was not found.
 */
export async function getLatestClimateSnapshot(
  scanLimit = 20,
): Promise<KalshiMarketSnapshot | null>;
export async function getLatestClimateSnapshot(
  scanLimit: number,
  withDiagnostic: true,
): Promise<{ snapshot: KalshiMarketSnapshot | null; diagnostic: ClimateSnapshotDiagnostic }>;
export async function getLatestClimateSnapshot(
  scanLimit = 20,
  withDiagnostic: boolean = false,
): Promise<
  | KalshiMarketSnapshot
  | null
  | { snapshot: KalshiMarketSnapshot | null; diagnostic: ClimateSnapshotDiagnostic }
> {
  const recent = await listMarketSnapshots(Math.max(1, Math.min(MAX_SNAPSHOTS, scanLimit)));
  const diagnostic: ClimateSnapshotDiagnostic = {
    scanned: recent.length,
    matchedByKind: 0,
    matchedByTickerPrefix: 0,
    recentKinds: recent.slice(0, 5).map((s) => s.kind ?? null),
    recentMarketCounts: recent.slice(0, 5).map((s) => s.markets.length),
    recentTickerPrefixes: Array.from(
      new Set(
        recent
          .flatMap((s) => s.markets.slice(0, 3).map((m) => (typeof m.ticker === 'string' ? m.ticker.slice(0, 6) : ''))),
      ),
    )
      .filter((p) => p.length > 0)
      .slice(0, 8),
    resolvedVia: null,
  };

  let resolved: KalshiMarketSnapshot | null = null;
  for (const s of recent) {
    if (s.kind === 'climate') {
      diagnostic.matchedByKind += 1;
      if (!resolved) {
        resolved = s;
        diagnostic.resolvedVia = 'kind_tag';
      }
    }
  }
  if (!resolved) {
    for (const s of recent) {
      if (s.markets.length === 0) continue;
      const allWeather = s.markets.every(
        (m) =>
          typeof m.ticker === 'string' &&
          (m.ticker.startsWith('KXHIGH') || m.ticker.startsWith('KXLOW')),
      );
      if (allWeather) {
        diagnostic.matchedByTickerPrefix += 1;
        if (!resolved) {
          resolved = s;
          diagnostic.resolvedVia = 'ticker_prefix_fallback';
        }
      }
    }
  }

  if (withDiagnostic) {
    return { snapshot: resolved, diagnostic };
  }
  return resolved;
}

/**
 * Parse a value retrieved from Upstash Redis into a KalshiMarketSnapshot.
 * The `@upstash/redis` REST client has `automaticDeserialization: true`
 * by default, so values stored as `JSON.stringify(snapshot)` come back
 * as already-parsed objects rather than strings. Earlier code asserted
 * `typeof raw === 'string'`, which dropped every snapshot on the floor.
 * Handle both shapes — string (legacy or rare paths) and object (the
 * Upstash default) — so the read path is robust to client config.
 */
function parseStoredSnapshot(raw: unknown): KalshiMarketSnapshot | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as KalshiMarketSnapshot;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as KalshiMarketSnapshot;
  }
  return null;
}

export async function listMarketSnapshots(
  limit = 50,
): Promise<KalshiMarketSnapshot[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_SNAPSHOTS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.snapshot(id));
  const rows = (await pipe.exec()) as Array<unknown>;
  const out: KalshiMarketSnapshot[] = [];
  for (const r of rows) {
    const parsed = parseStoredSnapshot(r);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function getMarketSnapshot(
  id: string,
): Promise<KalshiMarketSnapshot | null> {
  const redis = getRedis();
  const raw = await redis.get(KEY.snapshot(id));
  return parseStoredSnapshot(raw);
}

// ── Test connectivity (Step 118 follow-up) ──────────────────────────────────
//
// One-shot read-only probe that issues listMarkets({ limit: 1 }) against
// the configured Kalshi environment and returns a sanitized OK/error
// summary. Safe for callers to render directly to the admin UI: error
// codes and short messages only — no credentials, no signed bodies, no
// raw Kalshi error payloads that might echo headers.

export type ConnectivityCode =
  | 'ok'
  | 'credentials_missing'
  | 'auth_rejected'
  | 'kalshi_error'
  | 'network_error'
  | 'unknown';

export interface ConnectivityResult {
  code: ConnectivityCode;
  ok: boolean;
  /** HTTP status from Kalshi when applicable (0 for client-side failures). */
  httpStatus: number;
  env: KalshiEnv;
  /** Number of markets returned by the probe (0 on failure). */
  marketsReturned: number;
  /** Short, sanitized message safe to display to admins. */
  message: string;
}

function mapConnectivityCode(httpStatus: number, errorMessage?: string): ConnectivityCode {
  if (httpStatus === 401 || httpStatus === 403) return 'auth_rejected';
  if (httpStatus >= 400 && httpStatus < 600) return 'kalshi_error';
  if (httpStatus === 0) return 'network_error';
  if (errorMessage) return 'unknown';
  return 'unknown';
}

function sanitizeMessage(code: ConnectivityCode, httpStatus: number): string {
  switch (code) {
    case 'ok':
      return 'Connection succeeded.';
    case 'credentials_missing':
      return 'Credentials are not configured.';
    case 'auth_rejected':
      return 'Kalshi rejected the request (authentication or signature error).';
    case 'kalshi_error':
      return `Kalshi returned an error (HTTP ${httpStatus}).`;
    case 'network_error':
      return 'Could not reach Kalshi (network error).';
    default:
      return 'Connection check failed.';
  }
}

export async function testKalshiConnectivity(): Promise<ConnectivityResult> {
  const cfg = getKalshiConfig();
  if (!cfg.apiKeyId || !cfg.privateKeyPresent) {
    return {
      code: 'credentials_missing',
      ok: false,
      httpStatus: 0,
      env: cfg.env,
      marketsReturned: 0,
      message: sanitizeMessage('credentials_missing', 0),
    };
  }
  const res = await listMarkets({ limit: 1 });
  if (res.ok) {
    return {
      code: 'ok',
      ok: true,
      httpStatus: res.status,
      env: cfg.env,
      marketsReturned: res.data?.markets?.length ?? 0,
      message: sanitizeMessage('ok', res.status),
    };
  }
  const code = mapConnectivityCode(res.status, res.errorMessage);
  return {
    code,
    ok: false,
    httpStatus: res.status,
    env: cfg.env,
    marketsReturned: 0,
    message: sanitizeMessage(code, res.status),
  };
}
