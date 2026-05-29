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
  const cached = (await redis.get(cacheKey)) as string | null;
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { markets: KalshiMarketRaw[] };
      return { markets: parsed.markets ?? [], cached: true };
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

/** Series-name prefixes used to verify aggregated results client-side. */
const KALSHI_WEATHER_TICKER_PREFIXES: ReadonlyArray<string> = ['KXHIGH', 'KXLOW'];

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

  // First, try to discover weather series dynamically via /series so
  // we don't depend on hardcoded city-code guesses. Filter to those
  // starting with one of the known weather prefixes. This catches
  // cities I didn't think to guess.
  const discovered = new Set<string>();
  let listSeriesError: string | null = null;
  try {
    const resp = await listSeries({ limit: 1000 });
    if (resp.ok && resp.data?.series) {
      for (const s of resp.data.series) {
        if (
          typeof s.ticker === 'string' &&
          KALSHI_WEATHER_TICKER_PREFIXES.some((p) => s.ticker.startsWith(p))
        ) {
          discovered.add(s.ticker);
        }
      }
    } else if (!resp.ok) {
      listSeriesError = `status=${resp.status}: ${stringifyError(resp.errorMessage)}`;
    }
  } catch (err) {
    listSeriesError = stringifyError(err);
  }

  // Always also probe the hardcoded candidate list — covers cases
  // where /series returns a paginated subset that misses some weather
  // series. Dedup against the discovered set.
  const hardcoded = new Set<string>();
  for (const code of KALSHI_WEATHER_CITY_CODES) {
    hardcoded.add(`KXHIGH${code}`);
    hardcoded.add(`KXLOW${code}`);
  }
  for (const t of hardcoded) discovered.add(t);

  const seriesTickers: string[] = Array.from(discovered).sort();

  // Probe with bounded concurrency (5 at a time). The previous
  // Promise.all over 70+ series triggered Kalshi 429 too_many_requests
  // responses on ~all probes; capping concurrency keeps every probe
  // alive without overwhelming Kalshi's rate limit. Each call uses the
  // existing 60-second list cache, so repeated clicks within a minute
  // are still cheap.
  const KALSHI_PROBE_CONCURRENCY = 5;
  const responses = await runWithConcurrency(
    seriesTickers,
    KALSHI_PROBE_CONCURRENCY,
    async (st) => {
      try {
        const { markets, cached } = await cachedListMarkets({
          series_ticker: st,
          status: 'open',
          limit: 100,
        });
        return { st, markets, cached, error: null as string | null };
      } catch (err) {
        return {
          st,
          markets: [] as KalshiMarketRaw[],
          cached: false,
          error: stringifyError(err),
        };
      }
    },
  );

  // Aggregate non-empty responses + track which series actually had data.
  const allMarkets: KalshiMarketRaw[] = [];
  const seriesWithData: string[] = [];
  const errored: string[] = [];
  let anyCacheHit = false;
  for (const r of responses) {
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

  // Belt-and-suspenders: the API already filtered by series_ticker
  // exact match, but make sure every aggregated market still starts
  // with one of the known weather prefixes.
  const climateRaw = allMarkets.filter((m) =>
    typeof m.ticker === 'string' &&
    KALSHI_WEATHER_TICKER_PREFIXES.some((p) => m.ticker.startsWith(p)),
  );

  // Stable diagnostic summary in warnings so the admin UI surfaces it.
  warnings.push(
    `Probed ${seriesTickers.length} candidate series tickers (${discovered.size - hardcoded.size + Array.from(hardcoded).filter(t => discovered.has(t)).length} discovered via /series, ${KALSHI_WEATHER_CITY_CODES.length * 2} from hardcoded city list).`,
  );
  if (listSeriesError) {
    warnings.push(
      `/series discovery failed (${listSeriesError}). Falling back to hardcoded city list only.`,
    );
  }
  if (seriesWithData.length > 0) {
    warnings.push(
      `Series with open markets: ${seriesWithData.join(', ')}`,
    );
  } else if (errored.length === 0) {
    warnings.push(
      'No candidate weather series returned open markets. Either no climate markets are currently open on Kalshi, or city codes have changed and need updating.',
    );
  }
  if (errored.length > 0) {
    warnings.push(
      `${errored.length} candidate(s) errored: ${errored.slice(0, 5).join(' | ')}${errored.length > 5 ? '…' : ''}`,
    );
  }
  if (anyCacheHit) {
    warnings.push(
      'Some series served from 60-second list cache; click again after a minute to force fresh fetches.',
    );
  }

  const markets = climateRaw.map(normalizeMarket);

  // Stored query reflects the strategy used, for traceability.
  const query: ListMarketsParams = {
    status: 'open',
    limit: 100,
    // series_ticker is intentionally omitted because this snapshot
    // aggregates many series; surfacing one would be misleading.
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
 */
export async function getLatestClimateSnapshot(
  scanLimit = 20,
): Promise<KalshiMarketSnapshot | null> {
  const recent = await listMarketSnapshots(Math.max(1, Math.min(MAX_SNAPSHOTS, scanLimit)));
  for (const s of recent) {
    if (s.kind === 'climate') return s;
  }
  // Fallback: detect climate-shaped untagged snapshots by their tickers.
  for (const s of recent) {
    if (s.markets.length === 0) continue;
    const allWeather = s.markets.every(
      (m) =>
        typeof m.ticker === 'string' &&
        (m.ticker.startsWith('KXHIGH') || m.ticker.startsWith('KXLOW')),
    );
    if (allWeather) return s;
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
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as KalshiMarketSnapshot);
}

export async function getMarketSnapshot(
  id: string,
): Promise<KalshiMarketSnapshot | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.snapshot(id))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as KalshiMarketSnapshot;
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
