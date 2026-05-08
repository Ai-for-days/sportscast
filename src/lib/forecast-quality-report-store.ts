// ── Step 138: Bounded snapshot store for batch quality reports ──────────────
//
// Mirrors the Step 137 quality-gate store and Step 136 comparison store
// patterns: server-only, Redis-backed, retention 90 (rolling daily reports
// over a quarter). Stores compact `BatchQualityReport` only — no raw
// per-city forecast payloads, no PII, no betting data.

import { getRedis } from './redis';
import type { BatchQualityReport } from './forecast-quality-batch-runner';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-quality-report-store is server-only and must not be imported in client code',
  );
}

const KEY = {
  report: (id: string) => `forecast-quality-report:${id}`,
  all: 'forecast-quality-reports:all',
};
const MAX_REPORTS = 90;

function parseReport(raw: string | null | unknown): BatchQualityReport | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as BatchQualityReport)
      : (raw as BatchQualityReport);
  } catch {
    return null;
  }
}

export async function recordQualityReport(report: BatchQualityReport): Promise<void> {
  const redis = getRedis();
  const score = Date.parse(report.runAt) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.report(report.id), JSON.stringify(report));
  pipe.zadd(KEY.all, { score, member: report.id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_REPORTS - 1);
  await pipe.exec();
}

export async function listQualityReports(limit = 30): Promise<BatchQualityReport[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_REPORTS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (!ids || ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.report(id));
  const rows = (await pipe.exec()) as Array<string | null | unknown>;
  const out: BatchQualityReport[] = [];
  for (const row of rows) {
    const r = parseReport(row);
    if (r) out.push(r);
  }
  return out;
}

export async function getQualityReport(id: string): Promise<BatchQualityReport | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.report(id))) as string | null;
  return parseReport(raw);
}
