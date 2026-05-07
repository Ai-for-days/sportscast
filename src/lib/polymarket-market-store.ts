// ── Step 126: Polymarket market-data service (server-only) ──────────────────
//
// Owns the read-only weather-market discovery snapshot lifecycle: fetch from
// the Polymarket Gamma API, normalize into the public-safe internal shape,
// persist to Redis (bounded retention), and list/retrieve stored snapshots.
// This is the only module that should call the Polymarket client from the
// admin route — keeps the route handler thin.
//
// Mirrors src/lib/kalshi-market-data.ts for naming, retention, and audit
// integration so a single mental model covers both venues.
//
// Safety:
// - Server-only.
// - Read-only by construction; Polymarket has no order endpoints in this
//   client; no automatic mirroring or wager creation happens here.
// - Snapshots are the only writes performed (plus an audit event from the
//   admin route).

import { getRedis } from './redis';
import {
  discoverWeatherMarkets,
  listMarkets,
  type PolymarketMarketSummary,
} from './polymarket-client';

if (typeof window !== 'undefined') {
  throw new Error(
    'polymarket-market-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface PolymarketMarketSnapshot {
  id: string;
  createdAt: string;
  createdBy: string;
  source: 'polymarket';
  /** "tag" when the Gamma weather tag returned results, "keyword" otherwise. */
  strategy: 'tag' | 'keyword' | 'mixed';
  /** Human-readable note about how the upstream call was assembled. */
  note: string;
  query: { limit: number };
  markets: PolymarketMarketSummary[];
  warnings: string[];
  status: 'read_only_snapshot';
}

export class PolymarketMarketDataError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  snapshot: (id: string) => `polymarket-market-snapshot:${id}`,
  all: 'polymarket-market-snapshots:all',
};
const MAX_SNAPSHOTS = 200;

// ── Snapshot lifecycle ──────────────────────────────────────────────────────

function newSnapshotId(): string {
  return `pms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface FetchSnapshotOptions {
  /** Polymarket Gamma list limit. Capped at 500 by the client. */
  limit?: number;
}

export async function fetchAndStoreWeatherSnapshot(
  options: FetchSnapshotOptions,
  createdBy: string,
): Promise<PolymarketMarketSnapshot> {
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
  const warnings: string[] = [];

  let result;
  try {
    result = await discoverWeatherMarkets({ limit });
  } catch (err: any) {
    throw new PolymarketMarketDataError(
      err?.message ?? 'Polymarket discovery failed.',
      'polymarket_request_failed',
    );
  }

  const snapshot: PolymarketMarketSnapshot = {
    id: newSnapshotId(),
    createdAt: new Date().toISOString(),
    createdBy,
    source: 'polymarket',
    strategy: result.strategy,
    note: result.note,
    query: { limit },
    markets: result.markets,
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
): Promise<PolymarketMarketSnapshot[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_SNAPSHOTS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.snapshot(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as PolymarketMarketSnapshot);
}

export async function getMarketSnapshot(
  id: string,
): Promise<PolymarketMarketSnapshot | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.snapshot(id))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as PolymarketMarketSnapshot;
}

// ── Test connectivity ───────────────────────────────────────────────────────
//
// One-shot read-only probe that issues listMarkets({ limit: 1 }) against the
// Gamma API and returns a sanitized OK/error summary. Safe to render to the
// admin UI: error codes and short messages only — no headers, no raw upstream
// payloads.

export type ConnectivityCode =
  | 'ok'
  | 'polymarket_error'
  | 'network_error'
  | 'unknown';

export interface ConnectivityResult {
  code: ConnectivityCode;
  ok: boolean;
  /** HTTP status from Polymarket when applicable (0 for client-side failures). */
  httpStatus: number;
  /** Number of markets returned by the probe (0 on failure). */
  marketsReturned: number;
  /** Short, sanitized message safe to display to admins. */
  message: string;
}

function mapConnectivityCode(httpStatus: number): ConnectivityCode {
  if (httpStatus === 0) return 'network_error';
  if (httpStatus >= 400 && httpStatus < 600) return 'polymarket_error';
  return 'unknown';
}

function sanitizeMessage(code: ConnectivityCode, httpStatus: number): string {
  switch (code) {
    case 'ok':
      return 'Connection succeeded.';
    case 'polymarket_error':
      return `Polymarket returned an error (HTTP ${httpStatus}).`;
    case 'network_error':
      return 'Could not reach Polymarket Gamma API (network error).';
    default:
      return 'Connection check failed.';
  }
}

export async function testPolymarketConnectivity(): Promise<ConnectivityResult> {
  const res = await listMarkets({ limit: 1 });
  if (res.ok) {
    return {
      code: 'ok',
      ok: true,
      httpStatus: res.status,
      marketsReturned: Array.isArray(res.data) ? res.data.length : 0,
      message: sanitizeMessage('ok', res.status),
    };
  }
  const code = mapConnectivityCode(res.status);
  return {
    code,
    ok: false,
    httpStatus: res.status,
    marketsReturned: 0,
    message: sanitizeMessage(code, res.status),
  };
}
