// ── Step 169: Forecast divergence trend memory ──────────────────────────
//
// Lightweight Redis-backed history of divergence results keyed by
// `(locationKey, targetDate, metric, side)`. Lets the admin UI show
// whether forecast instability is improving / worsening / unchanged
// since the previous review, without touching the Step 165 scoring
// engine.
//
// **Admin-only operator intelligence — not customer-facing, not betting
// advice.** Pure store + pure analyzer; both wrapped in `try/catch` at
// every call site so a Redis flake never breaks the underlying
// divergence analysis.
//
// Bounded storage: `MAX_TREND_RECORDS_PER_KEY = 20` per key, enforced
// on every write via `LTRIM`. No global retention sweep needed; the
// key space grows only with new (location, date, metric, side) tuples.
//
// Persistence model: Redis list per key, newest-first via `LPUSH`
// followed by `LTRIM 0 (MAX-1)`. Reads use `LRANGE` and return records
// newest-first.

import { getRedis } from './redis';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-divergence-trend-store is server-only and must not be imported in client code',
  );
}

// ── Constants ──────────────────────────────────────────────────────────────

export const MAX_TREND_RECORDS_PER_KEY = 20;

/** Combined-instability delta (absolute) needed to declare a trend shift. */
export const TREND_DELTA_THRESHOLD = 8;

const KEY = (key: string) => `forecast-divergence-trend:${key}`;

// ── Public types ────────────────────────────────────────────────────────────

export interface ForecastDivergenceTrendRecord {
  /** Stable composite identity — see `buildTrendKey`. */
  key: string;
  savedIdeaId?: string;
  locationKey: string;
  cityName?: string;
  targetDate: string;
  metric: string;
  side?: string;
  divergenceScore: number;
  volatilityScore: number;
  stabilityLabel: string;
  settlementRisk: string;
  opportunitySignal: string;
  revisionMagnitude?: number;
  recordedAt: string;
}

export type ForecastDivergenceTrendLabel =
  | 'improving'
  | 'worsening'
  | 'unchanged'
  | 'insufficient_history';

export interface ForecastDivergenceTrendAnalysis {
  trendLabel: ForecastDivergenceTrendLabel;
  /** Latest combined-instability − previous combined-instability. Positive = worsening. */
  trendScoreDelta: number;
  /** Latest volatility − previous volatility. */
  volatilityDelta: number;
  latestRecordedAt?: string;
  previousRecordedAt?: string;
  explanation: string;
  reasons: string[];
  /** Number of records compared (capped at `MAX_TREND_RECORDS_PER_KEY`). */
  recordCount: number;
}

// ── Key composition ────────────────────────────────────────────────────────

/**
 * Build the stable identity used to index trend memory. Pure helper —
 * always produces the same string for the same logical (location,
 * date, metric, side) tuple. Lower-cased, pipe-separated, ASCII-safe.
 */
export function buildTrendKey(input: {
  locationKey: string;
  targetDate: string;
  metric: string;
  side?: string;
}): string {
  return [
    (input.locationKey ?? '').toLowerCase(),
    input.targetDate ?? '',
    (input.metric ?? '').toLowerCase(),
    (input.side ?? 'x').toLowerCase(),
  ].join('|');
}

// ── Store API ──────────────────────────────────────────────────────────────

function parseRecord(raw: string | null | unknown): ForecastDivergenceTrendRecord | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as ForecastDivergenceTrendRecord)
      : (raw as ForecastDivergenceTrendRecord);
  } catch {
    return null;
  }
}

/**
 * Write a trend record. **Never throws** — callers can wrap with
 * try/catch but the underlying I/O failures are absorbed here so the
 * divergence pipeline never breaks on a Redis flake.
 *
 * Bounded: enforces `MAX_TREND_RECORDS_PER_KEY` via `LTRIM` on every
 * write, so the per-key list can never grow past the cap.
 */
export async function recordForecastDivergenceTrend(
  record: ForecastDivergenceTrendRecord,
): Promise<boolean> {
  try {
    const redis = getRedis();
    const payload = JSON.stringify(record);
    await redis.lpush(KEY(record.key), payload);
    await redis.ltrim(KEY(record.key), 0, MAX_TREND_RECORDS_PER_KEY - 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * List the most-recent records for a key, newest first. Returns `[]`
 * on Redis failure. Bounded by `MAX_TREND_RECORDS_PER_KEY`.
 */
export async function listTrendRecords(
  key: string,
  limit = MAX_TREND_RECORDS_PER_KEY,
): Promise<ForecastDivergenceTrendRecord[]> {
  if (!key) return [];
  try {
    const redis = getRedis();
    const safeLimit = Math.max(1, Math.min(MAX_TREND_RECORDS_PER_KEY, limit));
    const raw = (await redis.lrange(KEY(key), 0, safeLimit - 1)) as Array<string | unknown>;
    const out: ForecastDivergenceTrendRecord[] = [];
    for (const r of raw) {
      const parsed = parseRecord(r);
      if (parsed) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Convenience: get the trend analysis for a key in one call. **Never
 * throws.** Returns the `insufficient_history` shape when nothing has
 * been recorded yet, so the caller can render the trend chip uniformly.
 */
export async function getForecastDivergenceTrend(
  key: string,
): Promise<ForecastDivergenceTrendAnalysis> {
  const records = await listTrendRecords(key);
  return analyzeForecastDivergenceTrend(records);
}

// ── Pure analyzer ──────────────────────────────────────────────────────────

function combined(record: ForecastDivergenceTrendRecord): number {
  return Math.max(record.divergenceScore, record.volatilityScore);
}

const LABEL_COPY: Record<ForecastDivergenceTrendLabel, string> = {
  improving: 'Stability improving',
  worsening: 'Instability increasing',
  unchanged: 'Little change',
  insufficient_history: 'Insufficient trend history',
};

/**
 * Pure deterministic trend classifier. **Compares latest record to
 * previous record only** — the Step 169 spec's simple heuristic. The
 * full record list is exposed via `listTrendRecords` for future
 * deeper analyses without changing this function's contract.
 */
export function analyzeForecastDivergenceTrend(
  records: readonly ForecastDivergenceTrendRecord[],
): ForecastDivergenceTrendAnalysis {
  if (records.length < 2) {
    return {
      trendLabel: 'insufficient_history',
      trendScoreDelta: 0,
      volatilityDelta: 0,
      latestRecordedAt: records[0]?.recordedAt,
      previousRecordedAt: undefined,
      explanation:
        records.length === 0
          ? 'No prior divergence reviews recorded for this idea yet.'
          : 'Only one prior divergence review on record — need a second sample to call a trend.',
      reasons: records.length === 0 ? ['no_history'] : ['only_one_record'],
      recordCount: records.length,
    };
  }

  const latest = records[0];
  const previous = records[1];
  const combinedLatest = combined(latest);
  const combinedPrev = combined(previous);
  const delta = roundTo(combinedLatest - combinedPrev, 1);
  const volatilityDelta = roundTo(latest.volatilityScore - previous.volatilityScore, 1);

  let trendLabel: ForecastDivergenceTrendLabel;
  if (delta >= TREND_DELTA_THRESHOLD) trendLabel = 'worsening';
  else if (delta <= -TREND_DELTA_THRESHOLD) trendLabel = 'improving';
  else trendLabel = 'unchanged';

  const reasons: string[] = [];
  if (trendLabel === 'worsening') {
    reasons.push(`Combined instability rose ${Math.abs(delta)} points since the previous review.`);
  } else if (trendLabel === 'improving') {
    reasons.push(`Combined instability fell ${Math.abs(delta)} points since the previous review.`);
  } else {
    reasons.push(
      `Combined instability changed by only ${Math.abs(delta)} points (threshold ${TREND_DELTA_THRESHOLD}).`,
    );
  }
  if (Math.abs(volatilityDelta) >= TREND_DELTA_THRESHOLD) {
    reasons.push(
      volatilityDelta > 0
        ? `Volatility score rose ${volatilityDelta} points.`
        : `Volatility score fell ${Math.abs(volatilityDelta)} points.`,
    );
  }
  if (previous.stabilityLabel !== latest.stabilityLabel) {
    reasons.push(
      `Stability label moved from "${previous.stabilityLabel}" to "${latest.stabilityLabel}".`,
    );
  }

  let explanation: string;
  if (trendLabel === 'worsening') {
    explanation = `Forecast instability has increased by ${Math.abs(delta)} points since the previous review.`;
  } else if (trendLabel === 'improving') {
    explanation = `Forecast stability is improving; combined instability fell by ${Math.abs(delta)} points.`;
  } else {
    explanation = `Forecast divergence is broadly unchanged since the previous review (Δ ${delta} points).`;
  }

  return {
    trendLabel,
    trendScoreDelta: delta,
    volatilityDelta,
    latestRecordedAt: latest.recordedAt,
    previousRecordedAt: previous.recordedAt,
    explanation,
    reasons,
    recordCount: records.length,
  };
}

/** Short display label for the trend chip. */
export function trendLabelCopy(label: ForecastDivergenceTrendLabel): string {
  return LABEL_COPY[label];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function roundTo(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
