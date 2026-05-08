// ── Step 137: Bounded snapshot store for admin quality-gate results ─────────
//
// Persists the compact ForecastQualityGateResult so the admin UI can show
// historical scoring runs without re-fetching observations. Mirrors the
// Step 136 forecast-provider-comparison-store: server-only, Redis-backed,
// retention 200, compact payload only.

import { getRedis } from './redis';
import type { ForecastQualityGateResult } from './forecast-quality-gates';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-quality-gate-store is server-only and must not be imported in client code',
  );
}

const KEY = {
  result: (id: string) => `forecast-quality-gate:${id}`,
  all: 'forecast-quality-gates:all',
};
const MAX_RESULTS = 200;

function parseResult(raw: string | null | unknown): ForecastQualityGateResult | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as ForecastQualityGateResult)
      : (raw as ForecastQualityGateResult);
  } catch {
    return null;
  }
}

export async function recordQualityGateResult(result: ForecastQualityGateResult): Promise<void> {
  const redis = getRedis();
  const score = Date.parse(result.scoredAt) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.result(result.id), JSON.stringify(result));
  pipe.zadd(KEY.all, { score, member: result.id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_RESULTS - 1);
  await pipe.exec();
}

export async function listQualityGateResults(limit = 50): Promise<ForecastQualityGateResult[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_RESULTS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.result(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;
  const out: ForecastQualityGateResult[] = [];
  for (const row of rows) {
    const r = parseResult(row);
    if (r) out.push(r);
  }
  return out;
}

export async function getQualityGateResult(id: string): Promise<ForecastQualityGateResult | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.result(id))) as string | null;
  return parseResult(raw);
}
