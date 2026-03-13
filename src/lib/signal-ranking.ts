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

async function buildSportsbookSignals(hedgingRecs: HedgingRecommendation[]): Promise<RankedSignal[]> {
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
    const edge = getSportsbookEdge(w);
    const hedging = hedgingMap.get(w.id);
    const moveCount = w.lineHistory?.length || 0;

    // Determine confidence based on model data quality
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (w.pricingSnapshot) {
      const snap = w.pricingSnapshot;
      if (snap.consensus?.count && snap.consensus.count >= 3) confidence = 'high';
      else if (snap.consensus?.count && snap.consensus.count >= 2) confidence = 'medium';
    }

    const eScore = scoreEdge(edge);
    const cScore = scoreConfidence(confidence);
    const lScore = scoreLiquidity(undefined, handle);
    const mScore = scoreModelAgreement(!!w.pricingSnapshot, drift);
    const rScore = riskPenalty(hedging?.riskLevel, liability);
    const signalScore = computeSignalScore(eScore, cScore, lScore, mScore, rScore);
    const sizingTier = getSizingTier(signalScore);

    const reasons: string[] = [];
    if (edge > 0.05) reasons.push(`Edge ${(edge * 100).toFixed(1)}%`);
    if (drift > 1) reasons.push(`Drift ${drift.toFixed(1)}`);
    if (hedging?.riskLevel === 'high' || hedging?.riskLevel === 'critical') reasons.push(`Risk: ${hedging.riskLevel}`);
    if (moveCount > 0) reasons.push(`${moveCount} line moves`);

    signals.push({
      id: `sb_${w.id}`,
      source: 'sportsbook',
      marketType: w.kind,
      title: w.title,
      locationName: getLocationName(w),
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
    });
  }

  return signals;
}

// ── Build Kalshi Signals ────────────────────────────────────────────────────

function buildKalshiRankedSignals(kalshiSignals: KalshiSignal[]): RankedSignal[] {
  return kalshiSignals
    .filter(s => s.mapped)
    .map(s => {
      const bestEdge = Math.abs(s.edgeYes) >= Math.abs(s.edgeNo) ? s.edgeYes : s.edgeNo;
      const absEdge = Math.abs(bestEdge);

      const eScore = scoreEdge(absEdge);
      const cScore = scoreConfidence(s.confidence);
      const lScore = scoreLiquidity(undefined, undefined); // no liquidity data from demo
      const mScore = s.mapped ? 80 : 30;
      const rScore = 80; // Kalshi has inherent risk limits via contract structure
      const signalScore = computeSignalScore(eScore, cScore, lScore, mScore, rScore);
      const sizingTier = getSizingTier(signalScore);

      const reasons: string[] = [];
      if (absEdge > 0.05) reasons.push(`Edge ${(absEdge * 100).toFixed(1)}%`);
      if (s.recommendedSide !== 'none') reasons.push(`Rec: ${s.recommendedSide.toUpperCase()}`);
      if (s.confidence === 'high') reasons.push('High confidence');

      return {
        id: `ks_${s.ticker}`,
        source: 'kalshi' as const,
        marketType: 'yes-no-threshold',
        title: s.title,
        locationName: s.locationName,
        metric: s.metric,
        targetDate: s.targetDate,
        edge: absEdge,
        confidence: s.confidence,
        signalScore,
        sizingTier,
        rankingReason: reasons.length > 0 ? reasons.join('; ') : 'Below edge threshold',
      };
    });
}

// ── Main Ranking Function ───────────────────────────────────────────────────

export async function generateRankedSignals(): Promise<RankedSignal[]> {
  const [kalshiSignals, hedgingRecs] = await Promise.all([
    generateAllSignals(),
    generateHedgingRecommendations(),
  ]);

  const [sportsbookSignals, kalshiRanked] = await Promise.all([
    buildSportsbookSignals(hedgingRecs),
    Promise.resolve(buildKalshiRankedSignals(kalshiSignals)),
  ]);

  const all = [...sportsbookSignals, ...kalshiRanked];
  all.sort((a, b) => b.signalScore - a.signalScore);

  return all;
}
