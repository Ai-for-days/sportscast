// ── Step 137: Observation-anchored forecast quality gates ───────────────────
//
// Pure scoring layer. Compares per-provider forecast values (captured at
// snapshot time) against official NWS observations once the target hours
// have elapsed. Returns per-(provider, horizon, field) absolute errors
// bucketed into good / acceptable / weak / unavailable.
//
// IMPORTANT BOUNDARY:
//   - This module is admin-only diagnostics. It does NOT participate in
//     market settlement, grading, or any customer-visible decision.
//   - Single-location single-hour comparisons are noisy by nature. The
//     score buckets are coarse on purpose. A "weak" reading on one
//     snapshot is not a verdict; it's a data point.
//   - Precipitation probability calibration requires many samples and is
//     intentionally NOT scored here at Step 137. The plumbing is in place
//     but the bucket is always "unavailable" with a note.

import type {
  CompactComparisonRun,
  ProviderHorizonPoint,
} from './forecast-provider-comparison-runner';
import type { NWSRawObservation } from './nws-observations';

export type QualityHorizon = 'h0' | 'h6' | 'h12' | 'h24';
export type QualityField = 'temperature' | 'windSpeed' | 'windGust' | 'precipitation';
export type QualityScoreBucket = 'good' | 'acceptable' | 'weak' | 'unavailable';

export interface FieldHorizonScore {
  field: QualityField;
  horizon: QualityHorizon;
  /** Provider's forecast at the horizon (rounded). */
  forecastValue: number | null;
  /** Observed value at the horizon (rounded). */
  observedValue: number | null;
  /** Absolute error |forecast − observed|, rounded. Null when either side missing. */
  absError: number | null;
  bucket: QualityScoreBucket;
  unit: string;
  /** Free-text note when unavailable / conservative. */
  note?: string;
}

export interface ProviderQualityScore {
  provider: string;
  label: string;
  scores: FieldHorizonScore[];
  /** Bucket counts across all scored cells. */
  summary: { good: number; acceptable: number; weak: number; unavailable: number };
}

export interface ForecastQualityObservationMatch {
  horizon: QualityHorizon;
  /** Target time = snapshot.runAt + horizon offset. */
  targetIso: string;
  /** Closest NWS observation time. Null when no observation in window. */
  matchedIso: string | null;
  /** Distance between target and matched observation, in minutes. */
  matchOffsetMinutes: number | null;
  /** Observed temp F at the matched obs (rounded). */
  observedTempF: number | null;
  observedWindMph: number | null;
  observedGustMph: number | null;
}

export interface ForecastQualityGateResult {
  id: string;
  /** Snapshot id this gate scored. */
  comparisonSnapshotId: string;
  comparisonRunAt: string;
  scoredAt: string;
  lat: number;
  lon: number;
  label?: string;
  /** NWS station that supplied observations, if resolvable. */
  stationId?: string;
  /** Which horizons have actually elapsed enough to score. */
  elapsedHorizons: QualityHorizon[];
  /** Notes about the observation source / matching window. */
  observationSourceNotes: string[];
  observationMatches: ForecastQualityObservationMatch[];
  providers: ProviderQualityScore[];
  warnings: string[];
}

// ── Thresholds ──────────────────────────────────────────────────────────────

const TEMP_GOOD_F = 2;
const TEMP_ACCEPT_F = 5;
const WIND_GOOD_MPH = 4;
const WIND_ACCEPT_MPH = 8;
const GUST_GOOD_MPH = 5;
const GUST_ACCEPT_MPH = 10;

const HORIZON_OFFSETS_MS: Record<QualityHorizon, number> = {
  h0: 0,
  h6: 6 * 3600 * 1000,
  h12: 12 * 3600 * 1000,
  h24: 24 * 3600 * 1000,
};

/** Allow observations to publish 10 minutes after the target hour. */
const HORIZON_PUBLISH_GRACE_MS = 10 * 60 * 1000;

/** Match window: a horizon is scored against the observation closest to its target,
 *  but only when that observation is within 60 min of the target. */
const OBSERVATION_MATCH_TOLERANCE_MS = 60 * 60 * 1000;

const HORIZON_LABELS: Record<QualityHorizon, string> = {
  h0: 'Now',
  h6: '+6h',
  h12: '+12h',
  h24: '+24h',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

export function horizonOffsetMs(h: QualityHorizon): number {
  return HORIZON_OFFSETS_MS[h];
}

export function horizonLabel(h: QualityHorizon): string {
  return HORIZON_LABELS[h];
}

export function listElapsedHorizons(runAtMs: number, nowMs = Date.now()): QualityHorizon[] {
  return (Object.keys(HORIZON_OFFSETS_MS) as QualityHorizon[]).filter((h) => {
    const targetMs = runAtMs + HORIZON_OFFSETS_MS[h];
    return targetMs + HORIZON_PUBLISH_GRACE_MS <= nowMs;
  });
}

export function findClosestObservation(
  observations: NWSRawObservation[],
  targetMs: number,
): { obs: NWSRawObservation; offsetMs: number } | null {
  if (!observations.length) return null;
  let bestObs: NWSRawObservation | null = null;
  let bestDiff = Infinity;
  for (const o of observations) {
    const t = Date.parse(o.time);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - targetMs);
    if (d < bestDiff) {
      bestDiff = d;
      bestObs = o;
    }
  }
  if (!bestObs) return null;
  return { obs: bestObs, offsetMs: bestDiff };
}

export function bucketForError(field: QualityField, absErr: number): QualityScoreBucket {
  switch (field) {
    case 'temperature':
      return absErr <= TEMP_GOOD_F ? 'good' : absErr <= TEMP_ACCEPT_F ? 'acceptable' : 'weak';
    case 'windSpeed':
      return absErr <= WIND_GOOD_MPH ? 'good' : absErr <= WIND_ACCEPT_MPH ? 'acceptable' : 'weak';
    case 'windGust':
      return absErr <= GUST_GOOD_MPH ? 'good' : absErr <= GUST_ACCEPT_MPH ? 'acceptable' : 'weak';
    case 'precipitation':
      return 'unavailable';
  }
}

function scoreOneField(
  field: QualityField,
  horizon: QualityHorizon,
  unit: string,
  forecastValue: number | undefined,
  observedValue: number | undefined,
  matchOffsetMs: number | null,
  isFutureHorizon: boolean,
): FieldHorizonScore {
  if (isFutureHorizon) {
    return {
      field,
      horizon,
      forecastValue: forecastValue ?? null,
      observedValue: null,
      absError: null,
      bucket: 'unavailable',
      unit,
      note: `${HORIZON_LABELS[horizon]} target time has not passed yet — too early to score.`,
    };
  }
  if (field === 'precipitation') {
    return {
      field,
      horizon,
      forecastValue: forecastValue ?? null,
      observedValue: observedValue ?? null,
      absError: null,
      bucket: 'unavailable',
      unit,
      note: 'Precipitation probability calibration requires many samples; not scored on a single snapshot.',
    };
  }
  if (forecastValue === undefined) {
    return {
      field,
      horizon,
      forecastValue: null,
      observedValue: observedValue ?? null,
      absError: null,
      bucket: 'unavailable',
      unit,
      note: 'Forecast value not present in the snapshot at this horizon.',
    };
  }
  if (observedValue === undefined) {
    return {
      field,
      horizon,
      forecastValue,
      observedValue: null,
      absError: null,
      bucket: 'unavailable',
      unit,
      note: 'No NWS observation matched this horizon (station may have a gap).',
    };
  }
  if (matchOffsetMs !== null && matchOffsetMs > OBSERVATION_MATCH_TOLERANCE_MS) {
    return {
      field,
      horizon,
      forecastValue,
      observedValue,
      absError: null,
      bucket: 'unavailable',
      unit,
      note: `Closest observation was ${Math.round(matchOffsetMs / 60000)} min off target — outside the 60 min match window.`,
    };
  }
  const absErr = Math.abs(forecastValue - observedValue);
  return {
    field,
    horizon,
    forecastValue,
    observedValue,
    absError: Math.round(absErr * 10) / 10,
    bucket: bucketForError(field, absErr),
    unit,
  };
}

export interface ScoreProviderInputs {
  provider: string;
  label: string;
  /** Per-horizon forecast points captured at snapshot time. */
  horizonValues?: Record<QualityHorizon, ProviderHorizonPoint | undefined>;
}

export interface HorizonObservationContext {
  horizon: QualityHorizon;
  isFutureHorizon: boolean;
  observed?: { tempF?: number; windMph?: number; gustMph?: number };
  matchOffsetMs: number | null;
}

export function scoreProvider(
  inputs: ScoreProviderInputs,
  contexts: HorizonObservationContext[],
): ProviderQualityScore {
  const scores: FieldHorizonScore[] = [];
  for (const ctx of contexts) {
    const fcst = inputs.horizonValues?.[ctx.horizon];
    scores.push(
      scoreOneField(
        'temperature',
        ctx.horizon,
        '°F',
        fcst?.tempF,
        ctx.observed?.tempF,
        ctx.matchOffsetMs,
        ctx.isFutureHorizon,
      ),
    );
    scores.push(
      scoreOneField(
        'windSpeed',
        ctx.horizon,
        'mph',
        fcst?.windMph,
        ctx.observed?.windMph,
        ctx.matchOffsetMs,
        ctx.isFutureHorizon,
      ),
    );
    scores.push(
      scoreOneField(
        'windGust',
        ctx.horizon,
        'mph',
        fcst?.gustMph,
        ctx.observed?.gustMph,
        ctx.matchOffsetMs,
        ctx.isFutureHorizon,
      ),
    );
  }
  const summary = { good: 0, acceptable: 0, weak: 0, unavailable: 0 };
  for (const s of scores) summary[s.bucket]++;
  return { provider: inputs.provider, label: inputs.label, scores, summary };
}

/** Compact projection of a CompactComparisonRun's provider rows for the runner. */
export function providerScoringInputs(snap: CompactComparisonRun): ScoreProviderInputs[] {
  const horizonValues = snap.providerHorizonValues ?? {};
  return snap.providerSummaries
    .filter((p) => p.ok)
    .map((p) => ({
      provider: p.provider,
      label: p.label,
      horizonValues: horizonValues[p.provider] as Record<QualityHorizon, ProviderHorizonPoint | undefined> | undefined,
    }));
}
