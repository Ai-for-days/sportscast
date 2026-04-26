// ── Signal Ranking Engine ────────────────────────────────────────────────────
//
// Scores and ranks both sportsbook and Kalshi trading opportunities using a
// transparent, tunable scoring system. Recommendation-only — no live execution.

import { listAllWagers } from './wager-store';
import { getWagerExposure } from './exposure';
import { generateAllSignals } from './kalshi-signals';
import { generateHedgingRecommendations } from './exposure-hedging';
import type { Wager, OverUnderWager, PointspreadWager, OddsWager } from './wager-types';
import type { KalshiSignal } from './kalshi-signals';
import type { HedgingRecommendation } from './exposure-hedging';
import { venues } from './venue-data';
import type { Venue } from './types';
import { loadCalibrationContext, calibrateSignal, type CalibrationContext } from './signal-calibration';
import { loadEligibilityContext, evaluateEligibility, type EligibilityContext } from './systematic-eligibility';
import type { StrategyMode } from './strategy-mode';

// ── Tunable Scoring Constants ───────────────────────────────────────────────

export const RANKING_WEIGHTS = {
  // Component weights (sum to 100 for final score)
  EDGE_WEIGHT: 35,
  CONFIDENCE_WEIGHT: 20,
  LIQUIDITY_WEIGHT: 15,
  MODEL_AGREEMENT_WEIGHT: 15,
  RISK_PENALTY_WEIGHT: 15,

  // Edge scoring thresholds
  EDGE_EXCELLENT: 0.15,   // 15%+ edge → max score
  EDGE_GOOD: 0.08,        // 8%+ edge → high score
  EDGE_MIN: 0.03,         // 3%+ edge → some score
  EDGE_DEAD_ZONE: 0.02,   // below this → 0

  // Sizing tier thresholds (on 0-100 signalScore)
  TIER_LARGE: 75,
  TIER_MEDIUM: 50,
  TIER_SMALL: 30,
  // below TIER_SMALL → no-trade

  // Confidence multipliers
  CONFIDENCE_HIGH: 1.0,
  CONFIDENCE_MEDIUM: 0.6,
  CONFIDENCE_LOW: 0.3,

  // Step 71: reliability-driven score + tier adjustments. Calibration is now
  // load-bearing — a poorly calibrated signal cannot ride on raw-edge alone.
  RELIABILITY_PENALTY_THRESHOLD: 0.5,  // below this, multiply score by RELIABILITY_PENALTY_FACTOR
  RELIABILITY_PENALTY_FACTOR: 0.85,    // 15% score downgrade
  RELIABILITY_CAP_NO_TRADE: 0.25,      // below this, force no-trade
  RELIABILITY_CAP_SMALL: 0.40,         // below this, cap at small tier
  RELIABILITY_CAP_MEDIUM: 0.60,        // below this, cap at medium tier (no large)
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export type SizingTier = 'no-trade' | 'small' | 'medium' | 'large';

export interface RankedSignal {
  id: string;
  source: 'sportsbook' | 'kalshi';
  marketType: string;
  title: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  targetTime?: string | null;

  edge: number;
  confidence: 'low' | 'medium' | 'high';
  uncertainty?: number;
  liquidity?: number;
  handle?: number;
  liability?: number;
  riskLevel?: string;
  modelAgreement?: number;

  signalScore: number;
  sizingTier: SizingTier;
  rankingReason: string;
  // Step 69: indoor / retractable venue context. Signals are NEVER suppressed;
  // when present, edgeMultiplier and confidenceDowngrade have already been
  // applied to the visible `edge` and `confidence` fields above.
  venueAdjustment?: {
    venueType: 'indoor' | 'retractable';
    edgeMultiplier: number;
    confidenceDowngradeApplied: boolean;
    flag: string; // e.g. indoor_venue_weather_impact_limited
    rawEdge: number; // original edge before haircut
    rawConfidence: 'low' | 'medium' | 'high'; // original confidence
  };
  // Step 70/71: calibration metadata.
  //
  // Step 71 makes calibration load-bearing: signalScore is now computed from
  // calibratedEdge, and sizingTier may be capped by reliabilityFactor.
  rawEdge?: number;             // post-venue, pre-calibration edge
  calibratedEdge?: number;      // rawEdge * reliabilityFactor
  reliabilityFactor?: number;   // [0, 1]
  calibrationNotes?: string[];  // human-readable explanations
  calibrationAdjusted?: boolean; // true when reliability penalty or tier cap fired

  // Step 77: systematic eligibility metadata. READ-ONLY label — never
  // creates candidates or triggers execution.
  systematicEligible?: boolean;
  systematicReason?: string[];
  systematicMode?: StrategyMode;

  // Step 78: probability snapshot at signal time. Exposed so the portfolio
  // allocation engine can compute Kelly without re-loading candidates.
  // Kalshi signals carry both; sportsbook signals leave them undefined and
  // fall back to a 50¢-market approximation.
  modelProbForSide?: number;   // model-assigned prob for the traded side
  marketProbForSide?: number;  // market-implied prob for the traded side
  side?: 'yes' | 'no';
}

// ── Step 70 helpers ─────────────────────────────────────────────────────────

function computeLeadHours(targetDate?: string): number | undefined {
  if (!targetDate) return undefined;
  const target = new Date(`${targetDate}T12:00:00Z`).getTime();
  if (Number.isNaN(target)) return undefined;
  return Math.max(0, (target - Date.now()) / 3_600_000);
}

// ── Step 69: Indoor / Retractable Venue Adjustment ──────────────────────────
//
// Weather-driven markets at fully enclosed venues are largely insensitive to
// the city forecast (the dome holds temperature/precip constant), so signals
// from those venues get a haircut rather than full removal. Retractable
// venues get a smaller haircut because the roof can be open in good weather.

export const INDOOR_EDGE_MULTIPLIER = 0.50;
export const RETRACTABLE_EDGE_MULTIPLIER = 0.75;
export const INDOOR_FLAG = 'indoor_venue_weather_impact_limited';
export const RETRACTABLE_FLAG = 'retractable_roof_weather_uncertain';

function downgradeConfidence(c: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  if (c === 'high') return 'medium';
  if (c === 'medium') return 'low';
  return 'low';
}

/**
 * Find a matching venue for a market locationName. Returns the first venue
 * whose team or city is contained in the location string (case-insensitive).
 * Used for indoor/retractable haircut detection only.
 */
function findVenueByLocation(locationName?: string): Venue | undefined {
  if (!locationName) return undefined;
  const loc = locationName.toLowerCase();
  // Prefer team match (more specific) before city match
  for (const v of venues) {
    if (v.team && loc.includes(v.team.toLowerCase())) return v;
  }
  for (const v of venues) {
    if (v.city && loc.includes(v.city.toLowerCase())) return v;
  }
  return undefined;
}

/**
 * Apply the venue haircut. Returns the adjusted edge + confidence and the
 * adjustment metadata (or null when no haircut applies).
 */
export function applyVenueAdjustment(
  locationName: string | undefined,
  rawEdge: number,
  rawConfidence: 'low' | 'medium' | 'high',
): {
  edge: number;
  confidence: 'low' | 'medium' | 'high';
  adjustment: RankedSignal['venueAdjustment'] | null;
} {
  const venue = findVenueByLocation(locationName);
  if (!venue || venue.type === 'outdoor') {
    return { edge: rawEdge, confidence: rawConfidence, adjustment: null };
  }

  const isIndoor = venue.type === 'indoor';
  const multiplier = isIndoor ? INDOOR_EDGE_MULTIPLIER : RETRACTABLE_EDGE_MULTIPLIER;
  const flag = isIndoor ? INDOOR_FLAG : RETRACTABLE_FLAG;
  // Retractable venues: per Step 69 spec, downgrade only if roof status is
  // unknown or closed. v1 has no roof-status feed, so treat as unknown -> downgrade.
  const downgrade = rawConfidence !== 'low';

  return {
    edge: rawEdge * multiplier,
    confidence: downgrade ? downgradeConfidence(rawConfidence) : rawConfidence,
    adjustment: {
      venueType: venue.type,
      edgeMultiplier: multiplier,
      confidenceDowngradeApplied: downgrade,
      flag,
      rawEdge,
      rawConfidence,
    },
  };
}

// ── Scoring Helpers ─────────────────────────────────────────────────────────

function scoreEdge(edge: number): number {
  const absEdge = Math.abs(edge);
  if (absEdge < RANKING_WEIGHTS.EDGE_DEAD_ZONE) return 0;
  if (absEdge >= RANKING_WEIGHTS.EDGE_EXCELLENT) return 100;
  if (absEdge >= RANKING_WEIGHTS.EDGE_GOOD) {
    return 70 + 30 * (absEdge - RANKING_WEIGHTS.EDGE_GOOD) / (RANKING_WEIGHTS.EDGE_EXCELLENT - RANKING_WEIGHTS.EDGE_GOOD);
  }
  if (absEdge >= RANKING_WEIGHTS.EDGE_MIN) {
    return 30 + 40 * (absEdge - RANKING_WEIGHTS.EDGE_MIN) / (RANKING_WEIGHTS.EDGE_GOOD - RANKING_WEIGHTS.EDGE_MIN);
  }
  return 15 * (absEdge - RANKING_WEIGHTS.EDGE_DEAD_ZONE) / (RANKING_WEIGHTS.EDGE_MIN - RANKING_WEIGHTS.EDGE_DEAD_ZONE);
}

function scoreConfidence(conf: 'low' | 'medium' | 'high'): number {
  if (conf === 'high') return 100 * RANKING_WEIGHTS.CONFIDENCE_HIGH;
  if (conf === 'medium') return 100 * RANKING_WEIGHTS.CONFIDENCE_MEDIUM;
  return 100 * RANKING_WEIGHTS.CONFIDENCE_LOW;
}

function scoreLiquidity(volume?: number, handle?: number): number {
  const val = volume ?? handle ?? 0;
  if (val >= 10000) return 100;
  if (val >= 5000) return 80;
  if (val >= 1000) return 60;
  if (val >= 100) return 40;
  if (val > 0) return 20;
  return 10; // no liquidity data = low but not zero
}

function scoreModelAgreement(hasPricingSnapshot: boolean, modelDrift?: number): number {
  if (!hasPricingSnapshot) return 30; // unknown = partial score
  if (modelDrift == null) return 50;
  if (modelDrift < 0.5) return 100;  // very close to model
  if (modelDrift < 1.0) return 80;
  if (modelDrift < 2.0) return 60;
  if (modelDrift < 3.0) return 40;
  return 20;
}

function riskPenalty(riskLevel?: string, liability?: number): number {
  // Higher risk = lower score (returns 0-100 where 100 = low risk)
  if (riskLevel === 'critical') return 10;
  if (riskLevel === 'high') return 30;
  if (riskLevel === 'medium') return 60;
  return 90; // low risk
}

function computeSignalScore(
  edgeScore: number,
  confidenceScore: number,
  liquidityScore: number,
  modelScore: number,
  riskScore: number,
): number {
  const W = RANKING_WEIGHTS;
  const raw = (
    edgeScore * W.EDGE_WEIGHT +
    confidenceScore * W.CONFIDENCE_WEIGHT +
    liquidityScore * W.LIQUIDITY_WEIGHT +
    modelScore * W.MODEL_AGREEMENT_WEIGHT +
    riskScore * W.RISK_PENALTY_WEIGHT
  ) / 100;
  return Math.round(Math.min(Math.max(raw, 0), 100) * 10) / 10;
}

function getSizingTier(score: number): SizingTier {
  if (score >= RANKING_WEIGHTS.TIER_LARGE) return 'large';
  if (score >= RANKING_WEIGHTS.TIER_MEDIUM) return 'medium';
  if (score >= RANKING_WEIGHTS.TIER_SMALL) return 'small';
  return 'no-trade';
}

// Step 71: reliability-aware score and tier helpers ─────────────────────────

/**
 * Apply the reliability score penalty if the signal's reliabilityFactor is
 * below RELIABILITY_PENALTY_THRESHOLD. Returns the (possibly downgraded)
 * score and a flag indicating whether the penalty fired.
 */
function applyReliabilityPenalty(rawScore: number, reliabilityFactor: number | undefined): {
  score: number;
  penaltyApplied: boolean;
} {
  const rf = reliabilityFactor ?? 1.0;
  if (rf < RANKING_WEIGHTS.RELIABILITY_PENALTY_THRESHOLD) {
    return {
      score: Math.round(rawScore * RANKING_WEIGHTS.RELIABILITY_PENALTY_FACTOR * 10) / 10,
      penaltyApplied: true,
    };
  }
  return { score: rawScore, penaltyApplied: false };
}

/**
 * Cap the sizing tier based on reliability. Returns the (possibly capped)
 * tier and whether a cap was applied.
 */
function applyReliabilityTierCap(tier: SizingTier, reliabilityFactor: number | undefined): {
  tier: SizingTier;
  capApplied: boolean;
} {
  const rf = reliabilityFactor ?? 1.0;
  if (rf < RANKING_WEIGHTS.RELIABILITY_CAP_NO_TRADE) {
    return { tier: 'no-trade', capApplied: tier !== 'no-trade' };
  }
  if (rf < RANKING_WEIGHTS.RELIABILITY_CAP_SMALL) {
    if (tier === 'large' || tier === 'medium') return { tier: 'small', capApplied: true };
    return { tier, capApplied: false };
  }
  if (rf < RANKING_WEIGHTS.RELIABILITY_CAP_MEDIUM) {
    if (tier === 'large') return { tier: 'medium', capApplied: true };
    return { tier, capApplied: false };
  }
  return { tier, capApplied: false };
}

// ── Build Sportsbook Signals ────────────────────────────────────────────────

function getModelDrift(w: Wager): number {
  const snap = w.pricingSnapshot;
  if (!snap) return 0;
  if (snap.overUnder) return Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine);
  if (snap.pointspread) return Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread);
  if (snap.rangeOdds) {
    const diffs = snap.rangeOdds.bands.map(b => Math.abs(b.postedOdds - b.suggestedOdds));
    return diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  }
  return 0;
}

function getSportsbookEdge(w: Wager): number {
  const snap = w.pricingSnapshot;
  if (!snap) return 0;
  // Edge = how far posted is from model (as a fraction of the line)
  if (snap.overUnder) {
    const diff = snap.overUnder.postedLine - snap.overUnder.suggestedLine;
    return Math.abs(diff) / Math.max(Math.abs(snap.overUnder.suggestedLine), 1);
  }
  if (snap.pointspread) {
    const diff = snap.pointspread.postedSpread - snap.pointspread.suggestedSpread;
    return Math.abs(diff) / Math.max(Math.abs(snap.pointspread.suggestedSpread), 1);
  }
  if (snap.rangeOdds) {
    const avgDiff = snap.rangeOdds.bands.reduce((s, b) => s + Math.abs(b.postedOdds - b.suggestedOdds), 0) / Math.max(snap.rangeOdds.bands.length, 1);
    return avgDiff / 100; // normalize from cents to fraction
  }
  return 0;
}

function getLocationName(w: Wager): string {
  if (w.kind === 'over-under') return (w as OverUnderWager).location.name;
  if (w.kind === 'odds') return (w as OddsWager).location.name;
  if (w.kind === 'pointspread') return `${(w as PointspreadWager).locationA.name} vs ${(w as PointspreadWager).locationB.name}`;
  return '';
}

async function buildSportsbookSignals(hedgingRecs: HedgingRecommendation[], calibrationCtx: CalibrationContext | null): Promise<RankedSignal[]> {
  const signals: RankedSignal[] = [];
  const hedgingMap = new Map<string, HedgingRecommendation>();
  for (const h of hedgingRecs) hedgingMap.set(h.wagerId, h);

  const allWagers = await listAllWagers(200);
  const openWagers = allWagers.filter(w => w.status === 'open' && w.pricingSnapshot);

  for (const w of openWagers) {
    let handle = 0;
    let liability = 0;
    try {
      const exp = await getWagerExposure(w.id);
      handle = exp.totalStakedCents;
      liability = exp.maxLiabilityCents;
    } catch { /* ignore */ }

    const drift = getModelDrift(w);
    const rawEdge = getSportsbookEdge(w);
    const hedging = hedgingMap.get(w.id);
    const moveCount = w.lineHistory?.length || 0;

    // Determine confidence based on model data quality
    let rawConfidence: 'low' | 'medium' | 'high' = 'low';
    if (w.pricingSnapshot) {
      const snap = w.pricingSnapshot;
      if (snap.consensus?.count && snap.consensus.count >= 3) rawConfidence = 'high';
      else if (snap.consensus?.count && snap.consensus.count >= 2) rawConfidence = 'medium';
    }

    const locationName = getLocationName(w);
    const adj = applyVenueAdjustment(locationName, rawEdge, rawConfidence);
    const edge = adj.edge;
    const confidence = adj.confidence;

    // Step 70/71: compute calibration BEFORE scoring so calibratedEdge can
    // feed scoreEdge directly. Sportsbook signals don't carry an explicit
    // YES/NO probability, so only the edge + horizon components contribute
    // to reliabilityFactor for these.
    let calib;
    if (calibrationCtx) {
      calib = calibrateSignal({
        rawEdge: edge,
        modelProbForSide: undefined,
        side: undefined,
        leadTimeHours: computeLeadHours(w.targetDate),
      }, calibrationCtx);
    }
    const effectiveEdge = calib?.calibratedEdge ?? edge;
    const reliability = calib?.reliabilityFactor;

    const eScore = scoreEdge(effectiveEdge);
    const cScore = scoreConfidence(confidence);
    const lScore = scoreLiquidity(undefined, handle);
    const mScore = scoreModelAgreement(!!w.pricingSnapshot, drift);
    const rScore = riskPenalty(hedging?.riskLevel, liability);
    const rawSignalScore = computeSignalScore(eScore, cScore, lScore, mScore, rScore);

    const penaltyResult = applyReliabilityPenalty(rawSignalScore, reliability);
    const signalScore = penaltyResult.score;
    const tierResult = applyReliabilityTierCap(getSizingTier(signalScore), reliability);
    const sizingTier = tierResult.tier;
    const calibrationAdjusted = penaltyResult.penaltyApplied || tierResult.capApplied;

    const reasons: string[] = [];
    if (edge > 0.05) reasons.push(`Edge ${(edge * 100).toFixed(1)}%`);
    if (drift > 1) reasons.push(`Drift ${drift.toFixed(1)}`);
    if (hedging?.riskLevel === 'high' || hedging?.riskLevel === 'critical') reasons.push(`Risk: ${hedging.riskLevel}`);
    if (moveCount > 0) reasons.push(`${moveCount} line moves`);
    if (adj.adjustment) reasons.push(adj.adjustment.venueType === 'indoor' ? 'Indoor venue: edge halved' : 'Retractable roof: edge × 0.75');
    if (calibrationAdjusted) {
      const bits: string[] = [];
      if (penaltyResult.penaltyApplied) bits.push('score −15%');
      if (tierResult.capApplied) bits.push(`tier capped at ${sizingTier}`);
      reasons.push(`Calibration-adjusted (rf=${(reliability ?? 1).toFixed(2)}: ${bits.join(', ')})`);
    }

    signals.push({
      id: `sb_${w.id}`,
      source: 'sportsbook',
      marketType: w.kind,
      title: w.title,
      locationName,
      metric: w.metric,
      targetDate: w.targetDate,
      targetTime: w.targetTime || null,
      edge,
      confidence,
      uncertainty: w.pricingSnapshot?.consensus?.stdDev,
      handle,
      liability,
      riskLevel: hedging?.riskLevel || 'low',
      modelAgreement: mScore,
      signalScore,
      sizingTier,
      rankingReason: reasons.length > 0 ? reasons.join('; ') : 'Low edge — hold',
      venueAdjustment: adj.adjustment ?? undefined,
      rawEdge: calib?.rawEdge,
      calibratedEdge: calib?.calibratedEdge,
      reliabilityFactor: calib?.reliabilityFactor,
      calibrationNotes: calib?.calibrationNotes,
      calibrationAdjusted: calibrationAdjusted || undefined,
    });
  }

  return signals;
}

// ── Build Kalshi Signals ────────────────────────────────────────────────────

function buildKalshiRankedSignals(kalshiSignals: KalshiSignal[], calibrationCtx: CalibrationContext | null): RankedSignal[] {
  return kalshiSignals
    .filter(s => s.mapped)
    .map(s => {
      const yesIsBest = Math.abs(s.edgeYes) >= Math.abs(s.edgeNo);
      const bestEdge = yesIsBest ? s.edgeYes : s.edgeNo;
      const rawAbsEdge = Math.abs(bestEdge);
      const sideTraded: 'yes' | 'no' = yesIsBest ? 'yes' : 'no';
      const modelProbForSide = sideTraded === 'yes' ? s.modelProbYes : s.modelProbNo;
      const marketProbForSide = sideTraded === 'yes'
        ? (s as any).marketProbYes
        : (s as any).marketProbNo;

      // Step 69: indoor / retractable haircut applied at signal-ranking
      const adj = applyVenueAdjustment(s.locationName, rawAbsEdge, s.confidence);
      const absEdge = adj.edge;
      const confidence = adj.confidence;

      // Step 70/71: compute calibration BEFORE scoring so calibratedEdge
      // can feed scoreEdge directly.
      let calib;
      if (calibrationCtx) {
        calib = calibrateSignal({
          rawEdge: absEdge,
          modelProbForSide,
          side: sideTraded,
          leadTimeHours: computeLeadHours(s.targetDate),
        }, calibrationCtx);
      }
      const effectiveEdge = calib?.calibratedEdge ?? absEdge;
      const reliability = calib?.reliabilityFactor;

      const eScore = scoreEdge(effectiveEdge);
      const cScore = scoreConfidence(confidence);
      const lScore = scoreLiquidity(undefined, undefined); // no liquidity data from demo
      const mScore = s.mapped ? 80 : 30;
      const rScore = 80; // Kalshi has inherent risk limits via contract structure
      const rawSignalScore = computeSignalScore(eScore, cScore, lScore, mScore, rScore);

      const penaltyResult = applyReliabilityPenalty(rawSignalScore, reliability);
      const signalScore = penaltyResult.score;
      const tierResult = applyReliabilityTierCap(getSizingTier(signalScore), reliability);
      const sizingTier = tierResult.tier;
      const calibrationAdjusted = penaltyResult.penaltyApplied || tierResult.capApplied;

      const reasons: string[] = [];
      if (absEdge > 0.05) reasons.push(`Edge ${(absEdge * 100).toFixed(1)}%`);
      if (s.recommendedSide !== 'none') reasons.push(`Rec: ${s.recommendedSide.toUpperCase()}`);
      if (confidence === 'high') reasons.push('High confidence');
      if (adj.adjustment) reasons.push(adj.adjustment.venueType === 'indoor' ? 'Indoor venue: edge halved' : 'Retractable roof: edge × 0.75');
      if (calibrationAdjusted) {
        const bits: string[] = [];
        if (penaltyResult.penaltyApplied) bits.push('score −15%');
        if (tierResult.capApplied) bits.push(`tier capped at ${sizingTier}`);
        reasons.push(`Calibration-adjusted (rf=${(reliability ?? 1).toFixed(2)}: ${bits.join(', ')})`);
      }

      return {
        id: `ks_${s.ticker}`,
        source: 'kalshi' as const,
        marketType: 'yes-no-threshold',
        title: s.title,
        locationName: s.locationName,
        metric: s.metric,
        targetDate: s.targetDate,
        edge: absEdge,
        confidence,
        signalScore,
        sizingTier,
        rankingReason: reasons.length > 0 ? reasons.join('; ') : 'Below edge threshold',
        venueAdjustment: adj.adjustment ?? undefined,
        rawEdge: calib?.rawEdge,
        calibratedEdge: calib?.calibratedEdge,
        reliabilityFactor: calib?.reliabilityFactor,
        calibrationNotes: calib?.calibrationNotes,
        calibrationAdjusted: calibrationAdjusted || undefined,
        // Step 78
        modelProbForSide,
        marketProbForSide,
        side: sideTraded,
      };
    });
}

// ── Main Ranking Function ───────────────────────────────────────────────────

export async function generateRankedSignals(): Promise<RankedSignal[]> {
  // Step 70: load calibration context once for the entire ranking pass.
  // If loading fails (e.g., Redis hiccup) we degrade gracefully — signals
  // still rank without calibration metadata rather than failing outright.
  let calibrationCtx: CalibrationContext | null = null;
  try {
    calibrationCtx = await loadCalibrationContext();
  } catch {
    calibrationCtx = null;
  }

  // Step 77: load eligibility context (strategy mode + edge-validation
  // segment verdicts). Optional — if unavailable, signals still rank without
  // systematic eligibility metadata.
  let eligibilityCtx: EligibilityContext | null = null;
  try {
    eligibilityCtx = await loadEligibilityContext();
  } catch {
    eligibilityCtx = null;
  }

  const [kalshiSignals, hedgingRecs] = await Promise.all([
    generateAllSignals(),
    generateHedgingRecommendations(),
  ]);

  const [sportsbookSignals, kalshiRanked] = await Promise.all([
    buildSportsbookSignals(hedgingRecs, calibrationCtx),
    Promise.resolve(buildKalshiRankedSignals(kalshiSignals, calibrationCtx)),
  ]);

  const all = [...sportsbookSignals, ...kalshiRanked];

  // Step 77: tag systematic eligibility as read-only metadata. Never affects
  // ordering, sizing, candidate creation, or execution.
  if (eligibilityCtx) {
    for (const s of all) {
      const result = evaluateEligibility({
        source: s.source,
        confidence: s.confidence,
        sizingTier: s.sizingTier,
        reliabilityFactor: s.reliabilityFactor,
        calibratedEdge: s.calibratedEdge,
        riskLevel: s.riskLevel,
        venueAdjustment: s.venueAdjustment,
      }, eligibilityCtx);
      s.systematicEligible = result.systematicEligible;
      s.systematicReason = result.systematicReason;
      s.systematicMode = result.systematicMode;
    }
  }

  // Sort by signalScore — which since Step 71 reflects calibratedEdge plus
  // any reliability penalty. Tier caps are also applied. Execution and risk
  // systems remain untouched (no auto-suppression at API level).
  all.sort((a, b) => b.signalScore - a.signalScore);

  return all;
}
