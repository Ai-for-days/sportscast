// ── Forecast Consensus Engine ────────────────────────────────────────────────
//
// Aggregates multiple forecast sources into a consensus forecast
// with estimated uncertainty distribution.

import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';
import { listForecastEntries } from './forecast-tracker-store';
import { normalizeSource } from './forecast-verification-v2';

// ── Step 69: Fixed Consensus Weights v1 ─────────────────────────────────────
// NWS is treated as the anchor; the other three sources contribute as
// secondary signals. Weights are intentionally fixed (not derived from
// inverse-MAE) until verification history is large enough to be stable.
// When a source is missing for a given location/date/metric the available
// weights are renormalized to sum to 1.0.
//
// Centralized here so a future runtime config UI can swap them without
// touching call sites.
export const CONSENSUS_WEIGHTS_V1: Record<string, number> = {
  nws: 0.40,
  wageronweather: 0.25,
  accuweather: 0.20,
  'weather.com': 0.15,
};

function fixedWeightForSource(source: string): number {
  return CONSENSUS_WEIGHTS_V1[source] ?? 0;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface SourceForecast {
  source: string;
  forecastValue: number;
  leadTimeHours: number;
}

export interface ConsensusForecast {
  sources: SourceForecast[];
  mean: number;
  weightedMean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  count: number;
}

export interface ProbabilityPoint {
  value: number;
  prob: number;
}

export interface ConsensusDistribution {
  mean: number;
  stdDev: number;
  probabilities: ProbabilityPoint[];
}

// ── Math helpers ────────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const sumSqDiff = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(sumSqDiff / (values.length - 1));
}

function gaussianPdf(x: number, mu: number, sigma: number): number {
  if (sigma === 0) return x === mu ? 1 : 0;
  const exp = -0.5 * ((x - mu) / sigma) ** 2;
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(exp);
}

// ── Consensus forecast ──────────────────────────────────────────────────────

export async function getConsensusForecast(
  locationName: string,
  metric: string,
  targetDate: string,
  targetTime?: string,
): Promise<ConsensusForecast | null> {
  const entries = await listForecastEntries(500);

  // Filter to matching location + metric + date + time
  const locLower = locationName.toLowerCase().trim();
  const matching = entries.filter(e =>
    e.locationName.toLowerCase().trim() === locLower &&
    e.metric === metric &&
    e.targetDate === targetDate &&
    (targetTime ? e.targetTime === targetTime : !e.targetTime)
  );

  if (matching.length === 0) return null;

  // Group by normalized source, keep most recent per source
  const bySource = new Map<string, ForecastEntry>();
  for (const e of matching) {
    const src = normalizeSource(e.source);
    const existing = bySource.get(src);
    if (!existing || new Date(e.inputAt).getTime() > new Date(existing.inputAt).getTime()) {
      bySource.set(src, e);
    }
  }

  const sources: SourceForecast[] = Array.from(bySource.entries()).map(([source, e]) => ({
    source,
    forecastValue: e.forecastValue,
    leadTimeHours: e.leadTimeHours,
  }));

  if (sources.length === 0) return null;

  const values = sources.map(s => s.forecastValue);
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const meanVal = Math.round((sum / values.length) * 10) / 10;
  const stdDevVal = Math.round(stdDev(values, meanVal) * 100) / 100;

  // Weighted mean using fixed v1 weights (Step 69). When sources are missing
  // we renormalize the available weights so they sum to 1.0 — preserving the
  // intended relative emphasis (e.g., NWS-only -> 100%, NWS+WoW -> 61.5%/38.5%).
  const rawWeights = sources.map(src => fixedWeightForSource(src.source));
  const totalWeight = rawWeights.reduce((s, w) => s + w, 0);
  let weightedMean: number;

  if (totalWeight > 0) {
    const weightedSum = sources.reduce((s, src, i) =>
      s + src.forecastValue * (rawWeights[i] / totalWeight),
      0,
    );
    weightedMean = Math.round(weightedSum * 10) / 10;
  } else {
    // No recognized sources — fall back to plain mean
    weightedMean = meanVal;
  }

  return {
    sources,
    mean: meanVal,
    weightedMean,
    median: Math.round(median(sorted) * 10) / 10,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev: stdDevVal,
    count: sources.length,
  };
}

// ── Consensus distribution ──────────────────────────────────────────────────

export function getConsensusDistribution(mean: number, sd: number): ConsensusDistribution {
  // Use a minimum stdDev of 1 to produce a meaningful distribution
  const sigma = Math.max(sd, 1);
  const rangeLow = Math.floor(mean - 4 * sigma);
  const rangeHigh = Math.ceil(mean + 4 * sigma);

  const raw: { value: number; density: number }[] = [];
  let totalDensity = 0;

  for (let v = rangeLow; v <= rangeHigh; v++) {
    const density = gaussianPdf(v, mean, sigma);
    raw.push({ value: v, density });
    totalDensity += density;
  }

  // Normalize so probabilities sum to ~1
  const probabilities: ProbabilityPoint[] = raw.map(r => ({
    value: r.value,
    prob: Math.round((r.density / totalDensity) * 10000) / 10000,
  }));

  return { mean, stdDev: sigma, probabilities };
}
