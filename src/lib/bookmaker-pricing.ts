// ── Bookmaker Pricing Layer ──────────────────────────────────────────────────
//
// Uses the forecast consensus engine to generate line suggestions
// for over/under and range-odds markets. Admin-facing only.

import { getConsensusForecast, getConsensusDistribution, type ConsensusForecast } from './forecast-consensus';

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
}): Promise<PointspreadSuggestion | null> {
  const [consA, consB] = await Promise.all([
    getConsensusForecast(input.locationAName, input.metric, input.targetDate, input.targetTime),
    getConsensusForecast(input.locationBName, input.metric, input.targetDate, input.targetTime),
  ]);

  if (!consA || !consB) return null;

  const meanA = consA.weightedMean ?? consA.mean;
  const meanB = consB.weightedMean ?? consB.mean;
  const sigmaA = Math.max(consA.stdDev, MIN_STD_DEV);
  const sigmaB = Math.max(consB.stdDev, MIN_STD_DEV);

  // Expected difference: A - B
  const expectedDiff = Math.round((meanA - meanB) * 10) / 10;

  // Spread: nearest 0.5 (pushes allowed for pointspreads, so keep .0 if it lands there)
  const spread = Math.round(expectedDiff * 2) / 2;

  // Combined stdDev assuming independence
  const diffStdDev = Math.max(Math.sqrt(sigmaA ** 2 + sigmaB ** 2), MIN_DIFF_STD_DEV);

  // P(A covers spread) = P(D > spread) where D ~ N(expectedDiff, diffStdDev)
  const locationAProb = probAbove(spread, expectedDiff, diffStdDev);
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
}): Promise<PricingSuggestion | null> {
  const consensus = await getConsensusForecast(
    input.locationName,
    input.metric,
    input.targetDate,
    input.targetTime,
  );

  if (!consensus) return null;

  const overUnder = suggestOverUnderLine(consensus);
  const rangeOdds = suggestRangeOdds(consensus);

  return { consensus, overUnder, rangeOdds };
}
