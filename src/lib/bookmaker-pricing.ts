// ── Bookmaker Pricing Layer ──────────────────────────────────────────────────
//
// Uses the forecast consensus engine to generate line suggestions
// for over/under and range-odds markets. Admin-facing only.

import { getConsensusForecast, getConsensusDistribution, type ConsensusForecast } from './forecast-consensus';
import { getForecast } from './weather-queries';
import type { ForecastResponse } from './types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface OverUnderSuggestion {
  line: number;
  fairLine: number;
  overProb: number;
  underProb: number;
  overOdds: number;
  underOdds: number;
  hold: number;
}

export interface RangeBand {
  label: string;
  minValue: number;
  maxValue: number;
  probability: number;
  fairOdds: number;
  offeredOdds: number;
}

export interface RangeOddsSuggestion {
  bands: RangeBand[];
}

export interface PricingSuggestion {
  consensus: ConsensusForecast;
  overUnder: OverUnderSuggestion;
  rangeOdds: RangeOddsSuggestion;
}

export interface PointspreadSuggestion {
  locationAConsensus: ConsensusForecast;
  locationBConsensus: ConsensusForecast;
  expectedDiff: number;
  spread: number;
  diffStdDev: number;
  locationAProb: number;
  locationBProb: number;
  locationAOdds: number;
  locationBOdds: number;
  hold: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_HOLD = 0.045; // 4.5% vig
const MIN_STD_DEV = 1.0;
const MIN_ODDS = -10000;
const MAX_ODDS = +10000;

// ── Live-forecast fallback for Suggest Line / Suggest Spread ────────────────
//
// Reported live (2026-08-23): "Generate Suggested Spread"/"Generate Pricing
// Recommendation" always failed with "No matching forecasts found" for any
// wager created off the Wager Schedule tool. Root cause: getConsensusForecast
// only reads the internal Forecast Tracker log (/admin/forecasts) — entries
// an operator manually records per exact location string/metric/date — never
// the live weather/consensus pipeline the rest of the site (Weatherboard,
// Wager Schedule) already uses. That log is realistically never populated for
// a venue an operator just picked spontaneously off a game schedule. When the
// tracker has nothing, fall back to a live single-point estimate from the
// same getForecast() consensus every other page uses, with a conservative
// fixed uncertainty (no multi-source disagreement history to compute a real
// one from, unlike the tracker's multi-source stdDev).
const LIVE_FALLBACK_STD_DEV = 3;

function extractLiveMetricValue(forecast: ForecastResponse, metric: string, targetDate: string, targetTime?: string): number | null {
  if (metric === 'actual_temp' && targetTime) {
    const targetMs = Date.parse(`${targetDate}T${targetTime}:00`);
    if (Number.isFinite(targetMs)) {
      let best: number | null = null;
      let bestDiffMs = Infinity;
      for (const h of forecast.hourly) {
        const ms = Date.parse(h.time);
        if (!Number.isFinite(ms)) continue;
        const diff = Math.abs(ms - targetMs);
        if (diff < bestDiffMs) { bestDiffMs = diff; best = h.tempF; }
      }
      return best;
    }
  }
  const daily = forecast.daily.find((d) => d.date === targetDate);
  if (!daily) return null;
  if (metric === 'high_temp') return daily.highF;
  if (metric === 'low_temp') return daily.lowF;
  if (metric === 'actual_wind') return daily.windSpeedMph;
  if (metric === 'actual_gust') return daily.windGustMph;
  return null;
}

async function buildLiveConsensusForecast(
  lat: number,
  lon: number,
  metric: string,
  targetDate: string,
  targetTime?: string,
): Promise<ConsensusForecast | null> {
  try {
    const forecast = await getForecast(lat, lon, 16);
    const value = extractLiveMetricValue(forecast, metric, targetDate, targetTime);
    if (value === null) return null;
    return {
      sources: [{ source: forecast.source?.label ?? 'wageronweather', forecastValue: value, leadTimeHours: 0 }],
      mean: value,
      weightedMean: value,
      median: value,
      min: value,
      max: value,
      stdDev: LIVE_FALLBACK_STD_DEV,
      count: 1,
    };
  } catch {
    return null;
  }
}

/** Forecast Tracker log first (real multi-source stdDev when available), falling back to a live single-point estimate when lat/lon are given and the tracker has nothing. */
async function getConsensusOrLiveFallback(
  locationName: string,
  metric: string,
  targetDate: string,
  targetTime: string | undefined,
  lat?: number,
  lon?: number,
): Promise<ConsensusForecast | null> {
  const tracked = await getConsensusForecast(locationName, metric, targetDate, targetTime);
  if (tracked) return tracked;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return buildLiveConsensusForecast(lat, lon, metric, targetDate, targetTime);
}

// ── Core odds conversion ────────────────────────────────────────────────────

/**
 * Convert probability (0–1) to American odds.
 * Applies optional vig adjustment before conversion.
 * Caps extreme outputs at ±10000.
 */
export function americanOddsFromProbability(prob: number, vigAdj?: number): number {
  let p = prob;
  if (vigAdj !== undefined) {
    p = Math.min(Math.max(p + vigAdj, 0.01), 0.99);
  }

  // Clamp to avoid division by zero / extreme values
  p = Math.min(Math.max(p, 0.01), 0.99);

  let odds: number;
  if (p >= 0.5) {
    // Favorite: negative odds
    odds = Math.round(-100 * p / (1 - p));
  } else {
    // Underdog: positive odds
    odds = Math.round(100 * (1 - p) / p);
  }

  return Math.min(Math.max(odds, MIN_ODDS), MAX_ODDS);
}

/**
 * Convert American odds to implied probability (0–1).
 */
export function probabilityFromAmericanOdds(odds: number): number {
  if (odds < 0) {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  } else {
    return 100 / (odds + 100);
  }
}

// ── Vig / hold ──────────────────────────────────────────────────────────────

/**
 * Apply vig to a two-way market by normalizing probabilities
 * so they sum to (1 + targetHold).
 * Returns adjusted probabilities and the actual hold.
 */
export function applyVigToTwoWayMarket(
  probOver: number,
  probUnder: number,
  targetHold: number = DEFAULT_HOLD,
): { adjOver: number; adjUnder: number; hold: number } {
  const fairTotal = probOver + probUnder;
  const vigTotal = 1 + targetHold;

  const adjOver = (probOver / fairTotal) * vigTotal;
  const adjUnder = (probUnder / fairTotal) * vigTotal;

  return {
    adjOver,
    adjUnder,
    hold: Math.round((adjOver + adjUnder - 1) * 10000) / 10000,
  };
}

// ── Gaussian CDF helper ─────────────────────────────────────────────────────

/**
 * Approximate the standard normal CDF using Abramowitz & Stegun formula.
 */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1 + sign * y);
}

/**
 * Probability that a Gaussian(mu, sigma) value falls above threshold.
 */
function probAbove(threshold: number, mu: number, sigma: number): number {
  return 1 - normalCdf((threshold - mu) / sigma);
}

/**
 * Probability that a Gaussian(mu, sigma) value falls within [lo, hi].
 */
function probBetween(lo: number, hi: number, mu: number, sigma: number): number {
  return normalCdf((hi - mu) / sigma) - normalCdf((lo - mu) / sigma);
}

// ── Over/Under suggestion ───────────────────────────────────────────────────

/**
 * Suggest an over/under line from the consensus forecast.
 * Uses half-point lines to avoid pushes.
 */
export function suggestOverUnderLine(consensus: ConsensusForecast): OverUnderSuggestion {
  const center = consensus.weightedMean ?? consensus.mean;
  const sigma = Math.max(consensus.stdDev, MIN_STD_DEV);

  // Nearest half-point line
  const fairLine = Math.round(center * 2) / 2;
  // Ensure it's a .5 to avoid pushes
  const line = Number.isInteger(fairLine) ? fairLine + 0.5 : fairLine;

  // Fair probabilities from Gaussian
  const overProb = probAbove(line, center, sigma);
  const underProb = 1 - overProb;

  // Apply vig
  const { adjOver, adjUnder, hold } = applyVigToTwoWayMarket(overProb, underProb);

  // Convert vigged probabilities to American odds
  const overOdds = americanOddsFromProbability(adjOver);
  const underOdds = americanOddsFromProbability(adjUnder);

  return {
    line,
    fairLine: Math.round(center * 10) / 10,
    overProb: Math.round(overProb * 10000) / 10000,
    underProb: Math.round(underProb * 10000) / 10000,
    overOdds,
    underOdds,
    hold,
  };
}

// ── Range odds suggestion ───────────────────────────────────────────────────

/**
 * Suggest 5 contiguous range-odds bands centered around the consensus.
 * Band width depends on stdDev:
 *   stdDev < 1.5 → width 2
 *   1.5 ≤ stdDev < 3 → width 3
 *   stdDev ≥ 3 → width 4
 */
export function suggestRangeOdds(consensus: ConsensusForecast): RangeOddsSuggestion {
  const center = consensus.weightedMean ?? consensus.mean;
  const sigma = Math.max(consensus.stdDev, MIN_STD_DEV);

  // Determine band width
  let width: number;
  if (sigma < 1.5) {
    width = 2;
  } else if (sigma < 3) {
    width = 3;
  } else {
    width = 4;
  }

  // 5 bands centered on the nearest integer to center
  const centerInt = Math.round(center);
  const totalSpan = width * 5;
  const startValue = centerInt - Math.floor(totalSpan / 2);

  const bands: RangeBand[] = [];
  let totalFairProb = 0;

  for (let i = 0; i < 5; i++) {
    const minValue = startValue + i * width;
    const maxValue = minValue + width - 1;

    // Probability from Gaussian: P(minValue - 0.5 < X < maxValue + 0.5)
    const probability = probBetween(minValue - 0.5, maxValue + 0.5, center, sigma);
    totalFairProb += probability;

    const fairOdds = americanOddsFromProbability(probability);

    bands.push({
      label: `${minValue}–${maxValue}`,
      minValue,
      maxValue,
      probability: Math.round(probability * 10000) / 10000,
      fairOdds,
      offeredOdds: 0, // placeholder — set after vig
    });
  }

  // Apply bookmaker margin: scale probabilities up so they sum to (1 + hold)
  const vigMultiplier = (1 + DEFAULT_HOLD) / totalFairProb;

  for (const band of bands) {
    const viggedProb = band.probability * vigMultiplier;
    band.offeredOdds = americanOddsFromProbability(Math.min(viggedProb, 0.99));
  }

  return { bands };
}

// ── Pointspread suggestion ──────────────────────────────────────────────────

const MIN_DIFF_STD_DEV = 1.25;

/**
 * Suggest a pointspread for a city-vs-city wager.
 * Fetches consensus for both locations independently, computes the
 * expected difference distribution, and generates spread + odds.
 */
export async function suggestPointspread(input: {
  locationAName: string;
  locationBName: string;
  metric: string;
  targetDate: string;
  targetTime?: string;
  locationALat?: number;
  locationALon?: number;
  locationBLat?: number;
  locationBLon?: number;
  metricA?: string;
  metricB?: string;
}): Promise<PointspreadSuggestion | null> {
  const [consA, consB] = await Promise.all([
    getConsensusOrLiveFallback(input.locationAName, input.metricA ?? input.metric, input.targetDate, input.targetTime, input.locationALat, input.locationALon),
    getConsensusOrLiveFallback(input.locationBName, input.metricB ?? input.metric, input.targetDate, input.targetTime, input.locationBLat, input.locationBLon),
  ]);

  if (!consA || !consB) return null;

  const meanA = consA.weightedMean ?? consA.mean;
  const meanB = consB.weightedMean ?? consB.mean;
  const sigmaA = Math.max(consA.stdDev, MIN_STD_DEV);
  const sigmaB = Math.max(consB.stdDev, MIN_STD_DEV);

  // Expected difference: A - B
  const expectedDiff = Math.round((meanA - meanB) * 10) / 10;

  // `spread` is locationA's own line in favorite/underdog notation (mirrors
  // locationAOdds/locationBOdds, and how PointspreadDisplay.tsx shows
  // spreadA=spread, spreadB=-spread) — the same convention as a standard
  // ATS spread bet, and the same one weather-market-idea-generator.ts's
  // balancedSpreadF already uses ("negative on the higher side"). A wins
  // when (A − B) + spread > 0, so a fair, ~50/50 line is the NEGATIVE of
  // the expected A-minus-B difference. Reported live (2026-08-23): this
  // used to emit +expectedDiff, the opposite sign — every wager priced
  // from this suggestion (as opposed to the idea generator's, which was
  // always correct) would have graded backwards under the fixed grading
  // formula in nws-grading.ts/wager-resolution.ts/wager-auto-grade.ts.
  const spread = Math.round(-expectedDiff * 2) / 2;

  // Combined stdDev assuming independence
  const diffStdDev = Math.max(Math.sqrt(sigmaA ** 2 + sigmaB ** 2), MIN_DIFF_STD_DEV);

  // P(A covers) = P((A−B) + spread > 0) = P(D > −spread) where D ~ N(expectedDiff, diffStdDev)
  const locationAProb = probAbove(-spread, expectedDiff, diffStdDev);
  const locationBProb = 1 - locationAProb;

  // Apply vig
  const { adjOver: adjA, adjUnder: adjB, hold } = applyVigToTwoWayMarket(locationAProb, locationBProb);

  // Convert to American odds
  const locationAOdds = americanOddsFromProbability(adjA);
  const locationBOdds = americanOddsFromProbability(adjB);

  return {
    locationAConsensus: consA,
    locationBConsensus: consB,
    expectedDiff,
    spread,
    diffStdDev: Math.round(diffStdDev * 100) / 100,
    locationAProb: Math.round(locationAProb * 10000) / 10000,
    locationBProb: Math.round(locationBProb * 10000) / 10000,
    locationAOdds,
    locationBOdds,
    hold,
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Generate full pricing suggestion from consensus data (over/under + range odds).
 */
export async function suggestPricing(input: {
  locationName: string;
  metric: string;
  targetDate: string;
  targetTime?: string;
  lat?: number;
  lon?: number;
}): Promise<PricingSuggestion | null> {
  const consensus = await getConsensusOrLiveFallback(
    input.locationName,
    input.metric,
    input.targetDate,
    input.targetTime,
    input.lat,
    input.lon,
  );

  if (!consensus) return null;

  const overUnder = suggestOverUnderLine(consensus);
  const rangeOdds = suggestRangeOdds(consensus);

  return { consensus, overUnder, rangeOdds };
}
