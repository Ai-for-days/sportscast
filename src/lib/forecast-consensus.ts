// ── Forecast Consensus Engine ────────────────────────────────────────────────
//
// Aggregates multiple forecast sources into a consensus forecast
// with estimated uncertainty distribution.

import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';
import { listForecastEntries } from './forecast-tracker-store';
import { normalizeSource } from './forecast-verification-v2';
import { getStatsBySource } from './forecast-stats';

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

// ── Source accuracy weights ─────────────────────────────────────────────────

async function getSourceWeights(): Promise<Map<string, number>> {
  const weights = new Map<string, number>();
  try {
    const stats = await getStatsBySource();
    for (const s of stats) {
      if (s.verifiedCount > 0 && s.avgAccuracyScoreV2 != null) {
        weights.set(s.source, s.avgAccuracyScoreV2);
      }
    }
  } catch {
    // If stats fail, return empty — caller uses equal weighting
  }
  return weights;
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

  // Weighted mean by source accuracy
  const sourceWeights = await getSourceWeights();
  let weightedMean: number;

  const totalWeight = sources.reduce((s, src) => {
    const w = sourceWeights.get(src.source) ?? 50; // default weight if no history
    return s + w;
  }, 0);

  if (totalWeight > 0) {
    const weightedSum = sources.reduce((s, src) => {
      const w = sourceWeights.get(src.source) ?? 50;
      return s + src.forecastValue * w;
    }, 0);
    weightedMean = Math.round((weightedSum / totalWeight) * 10) / 10;
  } else {
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
