// ── Forecast Verification V2 — Pure Helper Functions ────────────────────────
//
// All functions are pure (no side effects, no Redis) so they can be used
// for both real-time scoring and backfilling historical records.

import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';

// ── Metric classification ───────────────────────────────────────────────────

const TIME_SPECIFIC_METRICS: ReadonlySet<string> = new Set([
  'actual_temp',
  'wind_speed',
  'wind_gust',
  // Wager metric aliases (for future use)
  'actual_wind',
  'actual_gust',
]);

const DAILY_METRICS: ReadonlySet<string> = new Set([
  'high_temp',
  'low_temp',
]);

export function isTimeSpecificMetric(metric: string): boolean {
  return TIME_SPECIFIC_METRICS.has(metric);
}

export function isDailyMetric(metric: string): boolean {
  return DAILY_METRICS.has(metric);
}

// ── Metric group ────────────────────────────────────────────────────────────

const METRIC_TO_GROUP: Record<string, string> = {
  actual_temp: 'temperature',
  high_temp: 'temperature',
  low_temp: 'temperature',
  wind_speed: 'wind',
  wind_gust: 'wind',
  // Wager metric aliases
  actual_wind: 'wind',
  actual_gust: 'wind',
};

export function getMetricGroup(metric: string): string {
  return METRIC_TO_GROUP[metric] || 'unknown';
}

// ── Source normalization ────────────────────────────────────────────────────

export function normalizeSource(source: string[] | string | undefined | null): string {
  if (Array.isArray(source) && source.length > 0) return source[0];
  if (typeof source === 'string' && source.length > 0) return source;
  return 'wageronweather';
}

// ── Error calculations ──────────────────────────────────────────────────────

export function computeSignedError(forecastValue: number, actualValue: number): number {
  return Math.round((forecastValue - actualValue) * 10) / 10;
}

export function computeAbsError(signedError: number): number {
  return Math.round(Math.abs(signedError) * 10) / 10;
}

// ── Difficulty weight ───────────────────────────────────────────────────────

export function computeDifficultyWeight(leadTimeHours: number, metric: string): number {
  const base = 1 + Math.log(1 + leadTimeHours);
  const timeFactor = isTimeSpecificMetric(metric) ? 1.15 : 1.0;
  return Math.round(base * timeFactor * 10000) / 10000;
}

// ── Adjusted error ──────────────────────────────────────────────────────────

export function computeAdjustedError(absError: number, difficultyWeight: number): number {
  if (difficultyWeight === 0) return absError;
  return Math.round((absError / difficultyWeight) * 10000) / 10000;
}

// ── V2 accuracy score ───────────────────────────────────────────────────────

export function computeAccuracyScoreV2(adjustedError: number): number {
  return Math.max(0, Math.round(100 - 5 * adjustedError));
}

// ── Lead bucket ─────────────────────────────────────────────────────────────

const LEAD_BUCKETS: { maxHours: number; label: string }[] = [
  { maxHours: 1,    label: '0-1h' },
  { maxHours: 6,    label: '1-6h' },
  { maxHours: 24,   label: '6-24h' },
  { maxHours: 72,   label: '1-3d' },
  { maxHours: 120,  label: '3-5d' },
  { maxHours: 168,  label: '5-7d' },
  { maxHours: 240,  label: '7-10d' },
  { maxHours: 336,  label: '10-14d' },
];

export function getLeadBucket(leadTimeHours: number): string {
  for (const bucket of LEAD_BUCKETS) {
    if (leadTimeHours <= bucket.maxHours) return bucket.label;
  }
  return '14d+';
}

// ── Compute all V2 fields for a verified entry ──────────────────────────────

export interface V2Fields {
  sourceNormalized: string;
  signedError: number;
  absError: number;
  difficultyWeight: number;
  adjustedError: number;
  accuracyScoreV2: number;
  leadBucket: string;
  metricGroup: string;
  settledAt?: string;
}

export function computeV2Fields(entry: ForecastEntry): V2Fields | null {
  if (entry.actualValue == null) return null;

  const sourceNormalized = normalizeSource(entry.source);
  const signedError = computeSignedError(entry.forecastValue, entry.actualValue);
  const absError = computeAbsError(signedError);
  const difficultyWeight = computeDifficultyWeight(entry.leadTimeHours, entry.metric);
  const adjustedError = computeAdjustedError(absError, difficultyWeight);
  const accuracyScoreV2 = computeAccuracyScoreV2(adjustedError);
  const leadBucket = getLeadBucket(entry.leadTimeHours);
  const metricGroup = getMetricGroup(entry.metric);
  const settledAt = entry.verifiedAt || undefined;

  return {
    sourceNormalized,
    signedError,
    absError,
    difficultyWeight,
    adjustedError,
    accuracyScoreV2,
    leadBucket,
    metricGroup,
    settledAt,
  };
}
