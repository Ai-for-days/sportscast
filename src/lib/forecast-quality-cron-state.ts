// ── Step 139: Cron-state record for forecast quality automation ─────────────
//
// Single Redis record tracking the last seeded-comparison and last
// quality-report cron runs, used by both the cron endpoint (for cadence
// guards and idempotency) and the admin UI (for visibility into when the
// automation last fired).
//
// Server-only. No PII, no betting data, no secrets persisted.

import { getRedis } from './redis';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-quality-cron-state is server-only and must not be imported in client code',
  );
}

export type CronRunStatus = 'ran' | 'skipped' | 'failed';

export interface ForecastQualityCronState {
  /** ISO timestamp of the last *attempted* seeded comparison cron run. */
  lastSeededComparisonAt?: string;
  /** ISO timestamp of the last *successful* seeded comparison run. */
  lastSeededComparisonRanAt?: string;
  lastSeededComparisonStatus?: CronRunStatus;
  /** Short, human-readable summary of the last attempt. */
  lastSeededComparisonSummary?: string;

  lastQualityReportAt?: string;
  lastQualityReportRanAt?: string;
  lastQualityReportStatus?: CronRunStatus;
  lastQualityReportSummary?: string;

  /** Last cron-level failure summary (across either action). */
  lastFailureAt?: string;
  lastFailureSummary?: string;
}

const KEY = 'forecast-quality-cron-state';

function parseState(raw: string | null | unknown): ForecastQualityCronState {
  if (!raw) return {};
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as ForecastQualityCronState)
      : (raw as ForecastQualityCronState);
  } catch {
    return {};
  }
}

export async function getCronState(): Promise<ForecastQualityCronState> {
  const redis = getRedis();
  const raw = (await redis.get(KEY)) as string | null;
  return parseState(raw);
}

async function writeCronState(next: ForecastQualityCronState): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY, JSON.stringify(next));
}

export async function recordSeededComparisonAttempt(
  status: CronRunStatus,
  summary: string,
): Promise<ForecastQualityCronState> {
  const current = await getCronState();
  const now = new Date().toISOString();
  const next: ForecastQualityCronState = {
    ...current,
    lastSeededComparisonAt: now,
    lastSeededComparisonStatus: status,
    lastSeededComparisonSummary: summary,
  };
  if (status === 'ran') {
    next.lastSeededComparisonRanAt = now;
  }
  if (status === 'failed') {
    next.lastFailureAt = now;
    next.lastFailureSummary = `seeded-comparison: ${summary}`;
  }
  await writeCronState(next);
  return next;
}

export async function recordQualityReportAttempt(
  status: CronRunStatus,
  summary: string,
): Promise<ForecastQualityCronState> {
  const current = await getCronState();
  const now = new Date().toISOString();
  const next: ForecastQualityCronState = {
    ...current,
    lastQualityReportAt: now,
    lastQualityReportStatus: status,
    lastQualityReportSummary: summary,
  };
  if (status === 'ran') {
    next.lastQualityReportRanAt = now;
  }
  if (status === 'failed') {
    next.lastFailureAt = now;
    next.lastFailureSummary = `quality-report: ${summary}`;
  }
  await writeCronState(next);
  return next;
}

/**
 * True when enough time has passed since the last *successful* run of the
 * given action. Cadence guards block accidental re-runs from a misconfigured
 * cron schedule or human curl loop. Force=true bypasses (caller-side).
 */
export function isCadenceElapsed(
  lastRanAt: string | undefined,
  minIntervalMs: number,
  nowMs = Date.now(),
): boolean {
  if (!lastRanAt) return true;
  const t = Date.parse(lastRanAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= minIntervalMs;
}
