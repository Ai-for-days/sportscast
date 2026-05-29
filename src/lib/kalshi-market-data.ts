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
// (`KXHIGHDEN`, `KXHIGHNYC`, `KXLOWDEN`, …). Their `series_ticker` filter
// is exact-match, so there is no single value that captures "all
// climate markets" through that param. Instead, we use a free-text
// search on `temperature` and filter the response by ticker prefix.
//
// Mirrors the pattern shipped in commit `6c45a21` for
// `src/lib/kalshi.ts::fetchKalshiWeatherMarkets()`. Keep them aligned.

const KALSHI_WEATHER_TICKER_PREFIXES: ReadonlyArray<string> = ['KXHIGH', 'KXLOW'];

/**
 * Snapshot dedicated to climate markets. Forces `q=temperature`,
 * `status=open`, and a generous `limit`, then keeps only markets whose
 * ticker starts with one of the known weather prefixes. The stored
 * `query` reflects the forced params so the snapshot is self-describing.
 *
 * Returns the same shape as `fetchAndStoreMarketSnapshot`. Adds a
 * warning when the post-filter list is empty so the admin UI can show
 * a useful message ("0 climate markets matched — check that KXHIGH/
 * KXLOW are still the right ticker prefixes").
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

  const query: ListMarketsParams = { q: 'temperature', status: 'open', limit: 200 };
  const { markets: rawMarkets, cached } = await cachedListMarkets(query);
  if (cached) {
    warnings.push(
      'Markets served from 60-second list cache; click again after a minute to force a fresh fetch.',
    );
  }

  const climateRaw = rawMarkets.filter((m) =>
    typeof m.ticker === 'string' &&
    KALSHI_WEATHER_TICKER_PREFIXES.some((p) => m.ticker.startsWith(p)),
  );
  if (climateRaw.length === 0 && rawMarkets.length > 0) {
    // Diagnostic: surface a sample of what Kalshi actually returned so
    // we can spot whether KXHIGH/KXLOW were renamed, or whether
    // `q=temperature` is matching non-climate markets that crowd out
    // the real ones. Also surface a sample of distinct ticker prefixes
    // (first 6 chars) for the same reason.
    const sampleTickers = rawMarkets
      .map((m) => m.ticker)
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 20);
    const prefixes = Array.from(
      new Set(
        rawMarkets
          .map((m) => (typeof m.ticker === 'string' ? m.ticker.slice(0, 6) : ''))
          .filter((p) => p.length > 0),
      ),
    ).slice(0, 25);
    warnings.push(
      `Kalshi returned ${rawMarkets.length} markets for q=temperature but none matched the KXHIGH/KXLOW ticker prefixes. The prefix list may need updating.`,
    );
    warnings.push(
      `Sample tickers (first 20): ${sampleTickers.join(', ')}`,
    );
    warnings.push(
      `Distinct 6-char ticker prefixes seen (first 25): ${prefixes.join(', ')}`,
    );
  }
  const markets = climateRaw.map(normalizeMarket);

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
