// ── Weather market pricing ──────────────────────────────────────────────────
//
// Turns a pointspread idea into a priced market: a cover probability for each
// side, fair odds, and offered odds carrying a target hold.
//
// Why this exists: the idea generator set every line to the rounded forecast
// difference and priced both sides at a hardcoded -110. That prices a 10°F gap
// five days out identically to a 10°F gap tomorrow, even though the forecast
// error at five days is roughly double. Nothing estimated the chance a side
// actually covers, so the only margin was the fixed hold — and only when the
// action balanced.
//
// The model: let D be the forecast difference (A - B) and M the realised
// difference. The forecast error e = M - D is treated as Normal(0, sigma^2).
// Sigma grows with the forecast horizon and shrinks when the two locations
// share weather (correlated errors partly cancel in a difference).
//
// **Admin-only operator pricing. Not betting advice, never customer-facing.**
// Every default here is an ESTIMATE, exported so it can be recalibrated
// against the Forecast Tracker's own verified history — see calibration note
// on SIDE_MAE_BY_HORIZON_F.

export type PricingMetric = 'daily_high' | 'daily_low';

/**
 * Mean absolute error (°F) of a single location's daily high, by forecast
 * horizon in days. Index 0 = today. These are conservative published-verification
 * figures for consumer/NWS temperature forecasts, NOT measured from this system.
 *
 * TO CALIBRATE: the Forecast Tracker stores verified forecast-vs-observation
 * pairs. Replace these with measured MAE per horizon and the pricing sharpens
 * immediately — no other change required.
 */
export const SIDE_MAE_BY_HORIZON_F = [2.0, 2.5, 3.0, 3.6, 4.3, 5.0, 5.6] as const;

/** Beyond the table, degrade linearly. */
const MAE_GROWTH_PER_DAY_F = 0.6;

/** Daily lows verify slightly worse than highs (inversions, dewpoint sensitivity). */
const LOW_METRIC_MAE_MULTIPLIER = 1.1;

/** For a normal distribution, sigma = MAE * sqrt(pi/2). */
const MAE_TO_SIGMA = Math.sqrt(Math.PI / 2);

/**
 * Correlation between the two sides' forecast errors. Same-region pairs miss in
 * the same direction (one synoptic pattern), which CANCELS in a difference and
 * makes the spread easier to forecast than either side alone.
 */
export const SAME_REGION_ERROR_CORRELATION = 0.5;
export const CROSS_REGION_ERROR_CORRELATION = 0.15;

/** Default overround (vig) applied across both sides. 0.045 ~ the -110/-110 hold. */
export const DEFAULT_TARGET_HOLD = 0.045;

/** Odds are clamped so a lopsided line can't emit an absurd price. */
const MIN_AMERICAN_ODDS = 100;
const MAX_AMERICAN_ODDS = 2000;

// ── Math helpers ────────────────────────────────────────────────────────────

/** Abramowitz & Stegun 7.1.26 error function; max abs error ~1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Single-side forecast sigma (°F) for a horizon and metric. */
export function sideSigmaF(daysAhead: number, metric: PricingMetric = 'daily_high'): number {
  const d = Math.max(0, Math.round(daysAhead));
  const last = SIDE_MAE_BY_HORIZON_F.length - 1;
  const mae =
    d <= last
      ? SIDE_MAE_BY_HORIZON_F[d]
      : SIDE_MAE_BY_HORIZON_F[last] + (d - last) * MAE_GROWTH_PER_DAY_F;
  const adjusted = metric === 'daily_low' ? mae * LOW_METRIC_MAE_MULTIPLIER : mae;
  return adjusted * MAE_TO_SIGMA;
}

export interface SpreadSigmaInput {
  daysAhead: number;
  metricA?: PricingMetric;
  metricB?: PricingMetric;
  sameRegion?: boolean;
  /**
   * Optional °F disagreement between the contributing forecast sources for this
   * day. Source disagreement is a free, real-time uncertainty signal — when
   * Open-Meteo and NWS are 6°F apart, the day is genuinely less predictable than
   * the horizon alone implies. Added in quadrature.
   */
  sourceDisagreementF?: number;
}

/** Sigma (°F) of the DIFFERENCE between the two sides. */
export function spreadSigmaF(input: SpreadSigmaInput): number {
  const sA = sideSigmaF(input.daysAhead, input.metricA ?? 'daily_high');
  const sB = sideSigmaF(input.daysAhead, input.metricB ?? 'daily_high');
  const rho = input.sameRegion ? SAME_REGION_ERROR_CORRELATION : CROSS_REGION_ERROR_CORRELATION;
  const variance = sA * sA + sB * sB - 2 * rho * sA * sB;
  const base = Math.sqrt(Math.max(variance, 0.25)); // floor: never claim near-certainty
  const dis = input.sourceDisagreementF ?? 0;
  return dis > 0 ? Math.sqrt(base * base + dis * dis) : base;
}

// ── Odds conversion ─────────────────────────────────────────────────────────

/** Probability (0..1) → American odds. */
export function probabilityToAmericanOdds(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  const raw = clamped >= 0.5 ? -(100 * clamped) / (1 - clamped) : (100 * (1 - clamped)) / clamped;
  const magnitude = Math.min(Math.max(Math.abs(raw), MIN_AMERICAN_ODDS), MAX_AMERICAN_ODDS);
  return Math.round(raw < 0 ? -magnitude : magnitude);
}

/** American odds → implied probability (including vig). */
export function americanOddsToProbability(odds: number): number {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// ── Pricing ─────────────────────────────────────────────────────────────────

export interface PriceSpreadInput {
  /** Forecast difference, A - B, in °F. */
  forecastDifferenceF: number;
  /** The line on side A. A covers when (A - B) + spread > 0. */
  spreadF: number;
  /** Sigma of the difference, from spreadSigmaF. */
  sigmaF: number;
  /** Target overround. Defaults to DEFAULT_TARGET_HOLD. */
  targetHold?: number;
}

export interface SpreadPricing {
  /** True (no-vig) probability side A covers, given the market does not push. */
  fairProbabilityA: number;
  fairProbabilityB: number;
  /** Probability the market pushes (observations are whole °F, lines are whole °F). */
  pushProbability: number;
  fairOddsA: number;
  fairOddsB: number;
  /** Offered odds, carrying the hold. */
  oddsA: number;
  oddsB: number;
  /** Realised overround of the offered odds. */
  holdPct: number;
  sigmaF: number;
  /** How lopsided the line is, in sigmas. 0 = perfectly balanced. */
  edgeInSigmas: number;
}

/**
 * Price a pointspread market.
 *
 * Settlement compares whole-degree observations, so an exact tie is a real and
 * frequent outcome on a whole-number line. It is modelled explicitly as a push
 * band rather than folded into one side.
 */
export function priceSpread(input: PriceSpreadInput): SpreadPricing {
  const sigma = Math.max(input.sigmaF, 0.25);
  const { forecastDifferenceF: d, spreadF: s } = input;

  // A covers when M + s > 0, i.e. M > -s. The realised difference M is a whole
  // number of degrees, so a WHOLE-number line has a real push band
  // [-s - 0.5, -s + 0.5]. A half-degree line cannot be tied by a whole number,
  // so it has no push band at all — modelling one there would invent a ~10%
  // outcome that can never occur and quietly mis-split the two sides.
  const lineIsWhole = Number.isInteger(s);

  let pA: number;
  let pB: number;
  let pPush: number;

  if (lineIsWhole) {
    const zHigh = (-s + 0.5 - d) / sigma;
    const zLow = (-s - 0.5 - d) / sigma;
    pB = normalCdf(zLow); // M below the band -> A loses
    pPush = Math.max(normalCdf(zHigh) - normalCdf(zLow), 0);
    pA = Math.max(1 - normalCdf(zHigh), 0);
  } else {
    const z = (-s - d) / sigma;
    pB = normalCdf(z);
    pA = Math.max(1 - pB, 0);
    pPush = 0;
  }

  // Price on the conditional probabilities given no push — a push returns stakes.
  const live = pA + pB;
  const condA = live > 0 ? pA / live : 0.5;
  const condB = live > 0 ? pB / live : 0.5;

  const hold = input.targetHold ?? DEFAULT_TARGET_HOLD;
  // Spread the overround proportionally across both sides.
  const scale = 1 + hold;
  const offeredA = Math.min(condA * scale, 0.98);
  const offeredB = Math.min(condB * scale, 0.98);

  const oddsA = probabilityToAmericanOdds(offeredA);
  const oddsB = probabilityToAmericanOdds(offeredB);
  const impliedTotal = americanOddsToProbability(oddsA) + americanOddsToProbability(oddsB);

  return {
    fairProbabilityA: condA,
    fairProbabilityB: condB,
    pushProbability: pPush,
    fairOddsA: probabilityToAmericanOdds(condA),
    fairOddsB: probabilityToAmericanOdds(condB),
    oddsA,
    oddsB,
    holdPct: impliedTotal > 0 ? (impliedTotal - 1) / impliedTotal : 0,
    sigmaF: sigma,
    edgeInSigmas: Math.abs(condA - 0.5) * 2,
  };
}

export type LineGranularity = 'whole' | 'half';

/**
 * The suggested line for a forecast difference.
 *
 * 'whole' — the rounded forecast difference. A market can PUSH: settlement
 * compares whole-degree observations, so if the realised difference lands
 * exactly on the line, stakes are returned. That happens 5-10% of the time.
 *
 * 'half' — the nearest HALF degree, which makes a push arithmetically
 * impossible (a whole-degree difference can never equal a .5 line).
 *
 * Rounding rule for 'half': take the half-integer nearest the forecast
 * difference, `round(d - 0.5) + 0.5`. Because the forecast values are
 * themselves whole degrees, a forecast gap of exactly 10°F becomes a 10.5
 * line — so the favourite must win by 11 or more, and the tie goes to the
 * underdog. That is not a 50/50 line, and it is not meant to be: priceSpread()
 * computes the true cover probability and the odds compensate (roughly +105 /
 * -125 rather than -110 / -110). The old fixed -110 could not have expressed
 * that, which is why half-degree lines only became safe once pricing existed.
 */
export function balancedSpreadF(
  forecastDifferenceF: number,
  granularity: LineGranularity = 'half',
): number {
  if (granularity === 'whole') return -Math.round(forecastDifferenceF);
  // Work on the magnitude and reapply the sign, so the tie goes to the underdog
  // in BOTH directions. Doing this on the signed value instead lands on the
  // wrong side of the gap whenever B is the favourite, because JS rounds -7.5
  // to -7 (toward +Infinity), not away from zero.
  const sign = forecastDifferenceF < 0 ? -1 : 1;
  const half = Math.round(Math.abs(forecastDifferenceF) - 0.5) + 0.5;
  return -sign * half;
}
