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
};
const MAX_SNAPSHOTS = 200;

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

  const res = await listMarkets(query);
  if (!res.ok) {
    throw new KalshiMarketDataError(
      res.errorMessage ?? `Kalshi listMarkets failed (status ${res.status})`,
      'kalshi_request_failed',
    );
  }

  const markets = (res.data?.markets ?? []).map(normalizeMarket);

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
