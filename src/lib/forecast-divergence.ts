// ── Step 165: Forecast Divergence Intelligence Engine ───────────────────
//
// Admin-only operator intelligence layer over the existing
// `forecast-revision-store` snapshots (Step 132-ish revision tracking).
// Given a (location, target date, metric) and a series of historical
// forecast snapshots, this module computes:
//
//   - `divergenceScore`     — spread across snapshots (0-100)
//   - `volatilityScore`     — mean absolute revision magnitude (0-100)
//   - `revisionMagnitude`   — raw max single-revision change
//   - `stabilityLabel`      — 'stable' / 'watch' / 'unstable' / 'highly_unstable'
//   - `settlementRisk`      — 'low' / 'medium' / 'high'
//   - `opportunitySignal`   — 'low' / 'medium' / 'high'
//   - `explanation`         — short admin-facing sentence
//   - `reasons[]`           — bullet-list rationale
//
// **Admin-only operator guidance. NOT betting advice. NOT a customer
// signal.** The vocabulary is deliberately neutral (`unstable`, `watch`,
// `settlement risk`) and stays grep-clean of `edge | profit | value bet
// | should bet | likely winner | easy money | lock`.
//
// Trust posture:
//   - Pure functions — no I/O, no mutation, no network, no LLM.
//   - Deterministic — same inputs always produce the same output.
//   - Imports only types.
//   - No public-customer surface ever sees these scores. The Step 165
//     API + UI live under `requireAdmin`.

if (typeof window !== 'undefined') {
  // Pure module — safe in either env, but the API/UI consumers are
  // admin-only by gate, not by import-time throw.
}

// ── Public types ────────────────────────────────────────────────────────────

export type DivergenceMetric =
  | 'high_temp'
  | 'low_temp'
  | 'precipitation_probability'
  | 'wind_speed';

export const DIVERGENCE_METRICS: readonly DivergenceMetric[] = [
  'high_temp',
  'low_temp',
  'precipitation_probability',
  'wind_speed',
] as const;

export type StabilityLabel = 'stable' | 'watch' | 'unstable' | 'highly_unstable';

export const STABILITY_LABELS: readonly StabilityLabel[] = [
  'stable',
  'watch',
  'unstable',
  'highly_unstable',
] as const;

export type RiskLevel = 'low' | 'medium' | 'high';

export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'] as const;

export interface DivergenceSnapshotValue {
  /** ISO timestamp of when the upstream forecast was generated. */
  forecastTime: string;
  /** Numeric forecast value for the metric. */
  value: number;
  /** Optional provider/source label, used only for the explanation. */
  source?: string;
}

export interface DivergenceThresholds {
  low: number;
  moderate: number;
  high: number;
  /** "severe" is anything above `high`. */
}

export interface DivergenceInput {
  cityName?: string;
  /** YYYY-MM-DD. */
  targetDate: string;
  metric: DivergenceMetric;
  snapshots: readonly DivergenceSnapshotValue[];
  /** Days until target date. When omitted, falls back to a UTC-noon derivation. */
  daysUntilTarget?: number;
  /**
   * Optional override of the metric's noisiness. When omitted, defaults
   * to the metric-derived value (precipitation is noisier than
   * temperature). Higher noise → more cautious settlement risk.
   */
  metricNoiseHint?: 'low' | 'medium' | 'high';
}

export interface ForecastDivergenceResult {
  divergenceScore: number;
  volatilityScore: number;
  revisionMagnitude: number;
  spread: number;
  stabilityLabel: StabilityLabel;
  settlementRisk: RiskLevel;
  opportunitySignal: RiskLevel;
  explanation: string;
  reasons: string[];
  comparedForecasts: number;
  metric: DivergenceMetric;
  cityName?: string;
  targetDate?: string;
  daysUntilTarget?: number;
  thresholds: DivergenceThresholds;
}

// ── Metric metadata ─────────────────────────────────────────────────────────

const METRIC_LABEL: Record<DivergenceMetric, string> = {
  high_temp: 'high temperature',
  low_temp: 'low temperature',
  precipitation_probability: 'precipitation probability',
  wind_speed: 'wind speed',
};

const METRIC_UNIT: Record<DivergenceMetric, string> = {
  high_temp: '°F',
  low_temp: '°F',
  precipitation_probability: 'pp',
  wind_speed: 'mph',
};

/**
 * Per-metric scoring thresholds. Match the Step 165 spec verbatim.
 */
export function getDivergenceThresholds(metric: DivergenceMetric): DivergenceThresholds {
  switch (metric) {
    case 'high_temp':
    case 'low_temp':
      return { low: 2, moderate: 5, high: 9 };
    case 'precipitation_probability':
      return { low: 10, moderate: 25, high: 40 };
    case 'wind_speed':
      return { low: 4, moderate: 9, high: 15 };
  }
}

/**
 * Per-metric noisiness used to bias settlement risk upward when the
 * underlying metric is historically harder to nail. Precipitation is
 * the noisiest; temperature highs/lows are the calmest.
 */
function defaultMetricNoise(metric: DivergenceMetric): 'low' | 'medium' | 'high' {
  if (metric === 'precipitation_probability') return 'high';
  if (metric === 'wind_speed') return 'medium';
  return 'low';
}

// ── Public sub-scorers (exported for unit-test friendliness) ───────────────

/**
 * Pure max-min spread across snapshot values. Returns 0 for fewer than
 * two snapshots.
 */
export function calculateRawSpread(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  return Math.max(0, hi - lo);
}

/**
 * Mean absolute revision magnitude between consecutive snapshots
 * (ordered by forecastTime ascending). 0 when fewer than two.
 */
export function calculateForecastVolatility(
  input: Pick<DivergenceInput, 'snapshots' | 'metric'>,
): number {
  const sorted = sortByForecastTimeAsc(input.snapshots);
  if (sorted.length < 2) return 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].value;
    const b = sorted[i].value;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    sum += Math.abs(b - a);
    pairs += 1;
  }
  if (pairs === 0) return 0;
  const mean = sum / pairs;
  return round2(mean);
}

/**
 * Largest single-revision magnitude across consecutive snapshots.
 */
export function calculateRevisionMagnitude(
  input: Pick<DivergenceInput, 'snapshots' | 'metric'>,
): number {
  const sorted = sortByForecastTimeAsc(input.snapshots);
  if (sorted.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].value;
    const b = sorted[i].value;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = Math.abs(b - a);
    if (d > max) max = d;
  }
  return round2(max);
}

/**
 * Normalize a raw magnitude (spread / volatility / revision) to a 0-100
 * score using the metric's threshold curve. The threshold table is set
 * so that the metric's "severe" boundary maps to ~100.
 */
export function scoreFromMagnitude(magnitude: number, metric: DivergenceMetric): number {
  if (!Number.isFinite(magnitude) || magnitude < 0) return 0;
  switch (metric) {
    case 'high_temp':
    case 'low_temp':
      return Math.min(100, round2(magnitude * 10)); // 10°F+ → 100
    case 'precipitation_probability':
      return Math.min(100, round2(magnitude * 2.5)); // 40pp+ → 100
    case 'wind_speed':
      return Math.min(100, round2(magnitude * 6.25)); // 16mph+ → 100
  }
}

/**
 * Classify a 0-100 stability score into one of four labels. Boundaries:
 *   0-24   → stable
 *   25-49  → watch
 *   50-74  → unstable
 *   75-100 → highly_unstable
 */
export function classifyForecastStability(score: number): StabilityLabel {
  const s = clamp(score, 0, 100);
  if (s <= 24) return 'stable';
  if (s <= 49) return 'watch';
  if (s <= 74) return 'unstable';
  return 'highly_unstable';
}

/**
 * Settlement risk classifier. Increases when:
 *   - divergence + volatility are large
 *   - target date is still far out (uncertainty hasn't collapsed)
 *   - metric is historically noisy (per `metricNoiseHint`)
 */
export function classifySettlementRisk(args: {
  divergenceScore: number;
  volatilityScore: number;
  daysUntilTarget?: number;
  metricNoiseHint: 'low' | 'medium' | 'high';
}): RiskLevel {
  const base = Math.max(args.divergenceScore, args.volatilityScore);
  const horizonBonus =
    typeof args.daysUntilTarget === 'number'
      ? Math.max(0, Math.min(20, (args.daysUntilTarget - 1) * 4))
      : 0;
  const noiseBonus = args.metricNoiseHint === 'high' ? 15 : args.metricNoiseHint === 'medium' ? 8 : 0;
  const effective = base + horizonBonus + noiseBonus;
  if (effective >= 70) return 'high';
  if (effective >= 40) return 'medium';
  return 'low';
}

/**
 * Opportunity signal classifier. Increases with divergence + volatility
 * — but DECREASES when settlement risk is already 'high' (because the
 * market is operationally unclear in that case). Pure rule-based.
 */
export function classifyOpportunity(args: {
  divergenceScore: number;
  volatilityScore: number;
  settlementRisk: RiskLevel;
}): RiskLevel {
  const base = (args.divergenceScore + args.volatilityScore) / 2;
  if (args.settlementRisk === 'high') {
    // Strong signal but operator can't price it cleanly → cap at medium.
    if (base >= 70) return 'medium';
    if (base >= 40) return 'low';
    return 'low';
  }
  if (base >= 65) return 'high';
  if (base >= 35) return 'medium';
  return 'low';
}

// ── Explanation builder ────────────────────────────────────────────────────

const STABILITY_COPY: Record<StabilityLabel, string> = {
  stable: 'Stable',
  watch: 'Watch',
  unstable: 'Unstable',
  highly_unstable: 'Highly unstable',
};

const RISK_COPY: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function buildForecastDivergenceExplanation(result: ForecastDivergenceResult): string {
  const parts: string[] = [];
  const metric = METRIC_LABEL[result.metric];
  const unit = METRIC_UNIT[result.metric];
  const where = result.cityName ? ` for ${result.cityName}` : '';
  const when = result.targetDate ? ` on ${result.targetDate}` : '';
  parts.push(
    `${STABILITY_COPY[result.stabilityLabel]} ${metric} forecast${where}${when}, comparing ${result.comparedForecasts} snapshot(s).`,
  );
  parts.push(
    `Spread ${result.spread}${unit}; volatility ${result.volatilityScore}/100; max revision ${result.revisionMagnitude}${unit}.`,
  );
  parts.push(
    `${RISK_COPY[result.settlementRisk]} settlement risk · ${RISK_COPY[result.opportunitySignal]} opportunity signal.`,
  );
  return parts.join(' ');
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Pure, deterministic divergence calculator. Returns a fully-shaped
 * result even when the input has fewer than two snapshots (the result
 * just degrades to "insufficient_snapshots" reasoning so the admin UI
 * still has something to render).
 */
export function calculateForecastDivergence(
  input: DivergenceInput,
): ForecastDivergenceResult {
  const thresholds = getDivergenceThresholds(input.metric);
  const compared = input.snapshots.length;
  const values = input.snapshots.map((s) => s.value).filter((v) => Number.isFinite(v));
  const reasons: string[] = [];

  if (compared < 2 || values.length < 2) {
    // Graceful degraded result.
    const result: ForecastDivergenceResult = {
      divergenceScore: 0,
      volatilityScore: 0,
      revisionMagnitude: 0,
      spread: 0,
      stabilityLabel: 'stable',
      settlementRisk: 'low',
      opportunitySignal: 'low',
      explanation: '',
      reasons: ['insufficient_snapshots'],
      comparedForecasts: compared,
      metric: input.metric,
      cityName: input.cityName,
      targetDate: input.targetDate,
      daysUntilTarget: input.daysUntilTarget,
      thresholds,
    };
    result.explanation = buildForecastDivergenceExplanation(result);
    return result;
  }

  const spread = round2(calculateRawSpread(values));
  const volatility = calculateForecastVolatility(input);
  const revisionMagnitude = calculateRevisionMagnitude(input);

  const divergenceScore = scoreFromMagnitude(spread, input.metric);
  const volatilityScore = scoreFromMagnitude(volatility, input.metric);
  const stabilityScore = Math.max(divergenceScore, volatilityScore);
  const stabilityLabel = classifyForecastStability(stabilityScore);

  const metricNoiseHint = input.metricNoiseHint ?? defaultMetricNoise(input.metric);
  const settlementRisk = classifySettlementRisk({
    divergenceScore,
    volatilityScore,
    daysUntilTarget: input.daysUntilTarget,
    metricNoiseHint,
  });
  const opportunitySignal = classifyOpportunity({
    divergenceScore,
    volatilityScore,
    settlementRisk,
  });

  // Build reasons in the same order the spec lists them.
  const unit = METRIC_UNIT[input.metric];
  if (spread >= thresholds.high) {
    reasons.push(`Spread ${spread}${unit} exceeds the "high" threshold ${thresholds.high}${unit}.`);
  } else if (spread >= thresholds.moderate) {
    reasons.push(`Spread ${spread}${unit} sits in the "moderate" band (≥ ${thresholds.moderate}${unit}).`);
  } else if (spread > thresholds.low) {
    reasons.push(`Spread ${spread}${unit} is above the "low" band but below "moderate".`);
  }
  if (revisionMagnitude >= thresholds.moderate) {
    reasons.push(`Largest single revision ${revisionMagnitude}${unit} flagged as a significant change.`);
  }
  if (volatility > thresholds.low) {
    reasons.push(`Mean revision magnitude ${volatility}${unit} indicates an unsettled trajectory.`);
  }
  if (typeof input.daysUntilTarget === 'number' && input.daysUntilTarget >= 4) {
    reasons.push(`Target date is ${input.daysUntilTarget} days out — beyond-horizon uncertainty still in play.`);
  }
  if (metricNoiseHint === 'high') {
    reasons.push('Metric is historically noisy (precipitation probability) — settlement bands biased upward.');
  }
  if (stabilityLabel === 'stable') {
    reasons.push('No score crossed the "watch" boundary — current snapshot set looks settled.');
  }

  const partial: ForecastDivergenceResult = {
    divergenceScore,
    volatilityScore,
    revisionMagnitude,
    spread,
    stabilityLabel,
    settlementRisk,
    opportunitySignal,
    explanation: '',
    reasons,
    comparedForecasts: compared,
    metric: input.metric,
    cityName: input.cityName,
    targetDate: input.targetDate,
    daysUntilTarget: input.daysUntilTarget,
    thresholds,
  };
  partial.explanation = buildForecastDivergenceExplanation(partial);
  return partial;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sortByForecastTimeAsc(
  snapshots: readonly DivergenceSnapshotValue[],
): DivergenceSnapshotValue[] {
  return [...snapshots].sort((a, b) => {
    const ta = Date.parse(a.forecastTime);
    const tb = Date.parse(b.forecastTime);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
    return ta - tb;
  });
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
