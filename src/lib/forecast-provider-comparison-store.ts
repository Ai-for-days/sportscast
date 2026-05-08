// ── Step 136: Bounded snapshot store for admin forecast provider runs ──────
//
// Persists compact comparison snapshots so the admin UI can show historical
// runs without re-fetching from each provider. Mirrors the Kalshi /
// Polymarket admin snapshot stores: server-only, Redis-backed, bounded
// retention. Stores only the compact projection from
// `forecast-provider-comparison-runner.ts#toCompactRun` — never the raw
// per-provider ForecastResponse payloads.

import { getRedis } from './redis';
import type { CompactComparisonRun } from './forecast-provider-comparison-runner';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-provider-comparison-store is server-only and must not be imported in client code',
  );
}

const KEY = {
  snapshot: (id: string) => `forecast-provider-comparison:${id}`,
  all: 'forecast-provider-comparisons:all',
};
const MAX_SNAPSHOTS = 200;

function parseSnapshot(raw: string | null | unknown): CompactComparisonRun | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as CompactComparisonRun)
      : (raw as CompactComparisonRun);
  } catch {
    return null;
  }
}

export async function recordComparisonRun(snapshot: CompactComparisonRun): Promise<void> {
  const redis = getRedis();
  const score = Date.parse(snapshot.runAt) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.snapshot(snapshot.id), JSON.stringify(snapshot));
  pipe.zadd(KEY.all, { score, member: snapshot.id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_SNAPSHOTS - 1);
  await pipe.exec();
}

export async function listComparisonRuns(limit = 50): Promise<CompactComparisonRun[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_SNAPSHOTS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.snapshot(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;
  const out: CompactComparisonRun[] = [];
  for (const row of rows) {
    const snap = parseSnapshot(row);
    if (snap) out.push(snap);
  }
  return out;
}

export async function getComparisonRun(id: string): Promise<CompactComparisonRun | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.snapshot(id))) as string | null;
  return parseSnapshot(raw);
}
