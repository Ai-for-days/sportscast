import { listAllWagers } from './wager-store';
import { getWagerExposure } from './exposure';
import type { Wager, WagerKind, OverUnderWager, PointspreadWager, OddsWager } from './wager-types';

// ── Tunable Threshold Constants ─────────────────────────────────────────────

export const HEDGING_THRESHOLDS = {
  // Liability thresholds (in cents)
  LIABILITY_CRITICAL: 100_000,   // $1,000
  LIABILITY_HIGH: 50_000,        // $500
  LIABILITY_MEDIUM: 20_000,      // $200

  // Model drift thresholds (absolute difference)
  DRIFT_CRITICAL: 4.0,
  DRIFT_HIGH: 2.5,
  DRIFT_MEDIUM: 1.0,

  // Lopsided action thresholds (percentage of bets on one side)
  LOPSIDED_CRITICAL: 0.85,
  LOPSIDED_HIGH: 0.75,
  LOPSIDED_MEDIUM: 0.65,

  // Line move count thresholds
  MOVES_HIGH: 3,
  MOVES_MEDIUM: 2,

  // Liability-to-handle ratio
  LIABILITY_HANDLE_RATIO_HIGH: 0.75,
  LIABILITY_HANDLE_RATIO_MEDIUM: 0.50,
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RecommendedAction = 'hold' | 'move_line' | 'move_odds' | 'reduce_limits' | 'pause_market' | 'hedge_external';

export interface HedgingRecommendation {
  wagerId: string;
  title: string;
  ticketNumber: string;
  marketType: WagerKind;
  riskLevel: RiskLevel;
  recommendedAction: RecommendedAction;
  reason: string;

  inputs: {
    handle: number;
    liability: number;
    betCount: number;
    modelDrift?: number;
    moveCount?: number;
    lopsidedPct?: number;
    hasPricingSnapshot: boolean;
  };

  suggestedChanges?: {
    overUnder?: {
      suggestedLine?: number;
      suggestedOverOdds?: number;
      suggestedUnderOdds?: number;
    };
    pointspread?: {
      suggestedSpread?: number;
      suggestedLocationAOdds?: number;
      suggestedLocationBOdds?: number;
    };
    rangeOdds?: {
      suggestedBands?: Array<{
        label: string;
        suggestedOdds: number;
      }>;
    };
  };

  hedgeNotes?: string;
}

export interface HedgingOverview {
  openMarketCount: number;
  countByRiskLevel: Record<RiskLevel, number>;
  totalHandle: number;
  totalLiability: number;
  highCriticalCount: number;
}

// ── Risk Assessment ─────────────────────────────────────────────────────────

interface RiskInputs {
  liability: number;
  handle: number;
  betCount: number;
  modelDrift: number;
  moveCount: number;
  lopsidedPct: number;
  hasPricingSnapshot: boolean;
}

function assessRiskLevel(inputs: RiskInputs): RiskLevel {
  const T = HEDGING_THRESHOLDS;
  let score = 0;

  // Liability scoring
  if (inputs.liability >= T.LIABILITY_CRITICAL) score += 4;
  else if (inputs.liability >= T.LIABILITY_HIGH) score += 3;
  else if (inputs.liability >= T.LIABILITY_MEDIUM) score += 2;
  else if (inputs.liability > 0) score += 1;

  // Model drift scoring
  if (inputs.modelDrift >= T.DRIFT_CRITICAL) score += 3;
  else if (inputs.modelDrift >= T.DRIFT_HIGH) score += 2;
  else if (inputs.modelDrift >= T.DRIFT_MEDIUM) score += 1;

  // Lopsided action scoring
  if (inputs.lopsidedPct >= T.LOPSIDED_CRITICAL) score += 3;
  else if (inputs.lopsidedPct >= T.LOPSIDED_HIGH) score += 2;
  else if (inputs.lopsidedPct >= T.LOPSIDED_MEDIUM) score += 1;

  // Line move frequency scoring
  if (inputs.moveCount >= T.MOVES_HIGH) score += 2;
  else if (inputs.moveCount >= T.MOVES_MEDIUM) score += 1;

  // Liability-to-handle ratio scoring
  if (inputs.handle > 0) {
    const ratio = inputs.liability / inputs.handle;
    if (ratio >= T.LIABILITY_HANDLE_RATIO_HIGH) score += 2;
    else if (ratio >= T.LIABILITY_HANDLE_RATIO_MEDIUM) score += 1;
  }

  // Map score to risk level
  if (score >= 8) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

// ── Model Drift Calculation ─────────────────────────────────────────────────

function getModelDrift(w: Wager): number {
  const snap = w.pricingSnapshot;
  if (!snap) return 0;

  if (snap.overUnder) {
    return Math.abs(snap.overUnder.postedLine - snap.overUnder.suggestedLine);
  }
  if (snap.pointspread) {
    return Math.abs(snap.pointspread.postedSpread - snap.pointspread.suggestedSpread);
  }
  if (snap.rangeOdds) {
    const diffs = snap.rangeOdds.bands.map(b => Math.abs(b.postedOdds - b.suggestedOdds));
    if (diffs.length === 0) return 0;
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }
  return 0;
}

// ── Lopsided Action Detection ───────────────────────────────────────────────

function getLopsidedPct(byOutcome: Record<string, { betCount: number; stakedCents: number; maxPayoutCents: number }>): number {
  const outcomes = Object.values(byOutcome);
  if (outcomes.length < 2) return 0;
  const totalBets = outcomes.reduce((s, o) => s + o.betCount, 0);
  if (totalBets < 2) return 0;
  const maxBets = Math.max(...outcomes.map(o => o.betCount));
  return maxBets / totalBets;
}

// ── Recommended Action per Market Type ──────────────────────────────────────

function recommendOverUnder(w: OverUnderWager, risk: RiskLevel, inputs: RiskInputs): { action: RecommendedAction; reason: string; suggestedChanges?: HedgingRecommendation['suggestedChanges']; hedgeNotes?: string } {
  const snap = w.pricingSnapshot;

  if (risk === 'critical') {
    // Multiple line moves haven't fixed exposure → pause or hedge
    if (inputs.moveCount >= HEDGING_THRESHOLDS.MOVES_HIGH) {
      return {
        action: 'pause_market',
        reason: `Critical liability (${fmtUSD(inputs.liability)}) with ${inputs.moveCount} line moves not reducing exposure`,
        hedgeNotes: `Consider external hedge equivalent to ~${fmtUSD(inputs.liability)} exposure`,
      };
    }
    return {
      action: 'hedge_external',
      reason: `Critical liability (${fmtUSD(inputs.liability)}) — consider external hedge`,
      suggestedChanges: snap?.overUnder ? {
        overUnder: {
          suggestedLine: snap.overUnder.suggestedLine,
          suggestedOverOdds: snap.overUnder.suggestedOverOdds,
          suggestedUnderOdds: snap.overUnder.suggestedUnderOdds,
        },
      } : undefined,
      hedgeNotes: `Consider external hedge equivalent to ~${fmtUSD(inputs.liability)} exposure`,
    };
  }

  if (risk === 'high') {
    // Move line and/or odds toward model
    if (inputs.modelDrift >= HEDGING_THRESHOLDS.DRIFT_HIGH && snap?.overUnder) {
      const direction = snap.overUnder.postedLine > snap.overUnder.suggestedLine ? -0.5 : 0.5;
      return {
        action: 'move_line',
        reason: `High liability with significant model drift (${inputs.modelDrift.toFixed(1)} pts)`,
        suggestedChanges: {
          overUnder: {
            suggestedLine: w.line + direction,
          },
        },
      };
    }
    if (inputs.lopsidedPct >= HEDGING_THRESHOLDS.LOPSIDED_HIGH) {
      // Move odds to attract other side
      return {
        action: 'move_odds',
        reason: `High liability with ${Math.round(inputs.lopsidedPct * 100)}% action on one side`,
        suggestedChanges: {
          overUnder: {
            suggestedOverOdds: w.over.odds > w.under.odds ? w.over.odds - 10 : w.over.odds + 10,
            suggestedUnderOdds: w.under.odds > w.over.odds ? w.under.odds - 10 : w.under.odds + 10,
          },
        },
      };
    }
    return {
      action: 'reduce_limits',
      reason: `High liability (${fmtUSD(inputs.liability)}) — consider reducing max stake`,
    };
  }

  if (risk === 'medium') {
    if (inputs.modelDrift >= HEDGING_THRESHOLDS.DRIFT_MEDIUM && snap?.overUnder) {
      return {
        action: 'move_odds',
        reason: `Moderate model drift (${inputs.modelDrift.toFixed(1)} pts) — adjust odds`,
        suggestedChanges: {
          overUnder: {
            suggestedOverOdds: snap.overUnder.suggestedOverOdds,
            suggestedUnderOdds: snap.overUnder.suggestedUnderOdds,
          },
        },
      };
    }
    return { action: 'hold', reason: 'Medium risk — monitor closely' };
  }

  return { action: 'hold', reason: 'Low risk — no action needed' };
}

function recommendPointspread(w: PointspreadWager, risk: RiskLevel, inputs: RiskInputs): { action: RecommendedAction; reason: string; suggestedChanges?: HedgingRecommendation['suggestedChanges']; hedgeNotes?: string } {
  const snap = w.pricingSnapshot;

  if (risk === 'critical') {
    if (inputs.moveCount >= HEDGING_THRESHOLDS.MOVES_HIGH) {
      return {
        action: 'pause_market',
        reason: `Critical liability (${fmtUSD(inputs.liability)}) with ${inputs.moveCount} spread moves not reducing exposure`,
        hedgeNotes: `Consider external hedge equivalent to ~${fmtUSD(inputs.liability)} exposure`,
      };
    }
    return {
      action: 'hedge_external',
      reason: `Critical liability (${fmtUSD(inputs.liability)}) — consider external hedge`,
      hedgeNotes: `Consider external hedge equivalent to ~${fmtUSD(inputs.liability)} exposure`,
    };
  }

  if (risk === 'high') {
    if (inputs.modelDrift >= HEDGING_THRESHOLDS.DRIFT_HIGH && snap?.pointspread) {
      const direction = snap.pointspread.postedSpread > snap.pointspread.suggestedSpread ? -0.5 : 0.5;
      return {
        action: 'move_line',
        reason: `High liability with significant spread drift (${inputs.modelDrift.toFixed(1)} pts)`,
        suggestedChanges: {
          pointspread: {
            suggestedSpread: w.spread + direction,
          },
        },
      };
    }
    if (inputs.lopsidedPct >= HEDGING_THRESHOLDS.LOPSIDED_HIGH) {
      return {
        action: 'move_odds',
        reason: `High liability with ${Math.round(inputs.lopsidedPct * 100)}% action on one side`,
        suggestedChanges: {
          pointspread: {
            suggestedLocationAOdds: w.locationAOdds - 5,
            suggestedLocationBOdds: w.locationBOdds + 5,
          },
        },
      };
    }
    return {
      action: 'reduce_limits',
      reason: `High liability (${fmtUSD(inputs.liability)}) — consider reducing max stake`,
    };
  }

  if (risk === 'medium') {
    if (inputs.modelDrift >= HEDGING_THRESHOLDS.DRIFT_MEDIUM) {
      return {
        action: 'move_odds',
        reason: `Moderate spread drift (${inputs.modelDrift.toFixed(1)} pts) — adjust side odds`,
      };
    }
    return { action: 'hold', reason: 'Medium risk — monitor closely' };
  }

  return { action: 'hold', reason: 'Low risk — no action needed' };
}

function recommendRangeOdds(w: OddsWager, risk: RiskLevel, inputs: RiskInputs): { action: RecommendedAction; reason: string; suggestedChanges?: HedgingRecommendation['suggestedChanges']; hedgeNotes?: string } {
  const snap = w.pricingSnapshot;

  if (risk === 'critical') {
    if (inputs.moveCount >= HEDGING_THRESHOLDS.MOVES_HIGH) {
      return {
        action: 'pause_market',
        reason: `Critical liability (${fmtUSD(inputs.liability)}) — odds adjustments not reducing exposure`,
        hedgeNotes: `Consider external hedge equivalent to ~${fmtUSD(inputs.liability)} exposure`,
      };
    }
    return {
      action: 'hedge_external',
      reason: `Critical liability (${fmtUSD(inputs.liability)}) — consider external hedge`,
      hedgeNotes: `Consider external hedge equivalent to ~${fmtUSD(inputs.liability)} exposure`,
    };
  }

  if (risk === 'high') {
    // Shorten most exposed bands
    if (snap?.rangeOdds) {
      const adjustedBands = snap.rangeOdds.bands.map(b => ({
        label: b.label,
        suggestedOdds: b.suggestedOdds,
      }));
      return {
        action: 'move_odds',
        reason: `High liability — shorten exposed bands toward model odds`,
        suggestedChanges: {
          rangeOdds: { suggestedBands: adjustedBands },
        },
      };
    }
    return {
      action: 'reduce_limits',
      reason: `High liability (${fmtUSD(inputs.liability)}) — consider reducing max stake`,
    };
  }

  if (risk === 'medium') {
    return { action: 'hold', reason: 'Medium risk — monitor band exposure' };
  }

  return { action: 'hold', reason: 'Low risk — no action needed' };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Main Engine ─────────────────────────────────────────────────────────────

export async function generateHedgingRecommendations(): Promise<HedgingRecommendation[]> {
  const allWagers = await listAllWagers(200);
  const openWagers = allWagers.filter(w => w.status === 'open');

  const recommendations: HedgingRecommendation[] = [];

  for (const w of openWagers) {
    let handle = 0;
    let liability = 0;
    let betCount = 0;
    let byOutcome: Record<string, { betCount: number; stakedCents: number; maxPayoutCents: number }> = {};

    try {
      const exp = await getWagerExposure(w.id);
      handle = exp.totalStakedCents;
      liability = exp.maxLiabilityCents;
      betCount = exp.totalBets;
      byOutcome = exp.byOutcome;
    } catch { /* ignore */ }

    const modelDrift = getModelDrift(w);
    const moveCount = w.lineHistory?.length || 0;
    const lopsidedPct = getLopsidedPct(byOutcome);

    const riskInputs: RiskInputs = {
      liability,
      handle,
      betCount,
      modelDrift,
      moveCount,
      lopsidedPct,
      hasPricingSnapshot: !!w.pricingSnapshot,
    };

    const riskLevel = assessRiskLevel(riskInputs);

    let result: { action: RecommendedAction; reason: string; suggestedChanges?: HedgingRecommendation['suggestedChanges']; hedgeNotes?: string };

    if (w.kind === 'over-under') {
      result = recommendOverUnder(w as OverUnderWager, riskLevel, riskInputs);
    } else if (w.kind === 'pointspread') {
      result = recommendPointspread(w as PointspreadWager, riskLevel, riskInputs);
    } else {
      result = recommendRangeOdds(w as OddsWager, riskLevel, riskInputs);
    }

    recommendations.push({
      wagerId: w.id,
      title: w.title,
      ticketNumber: w.ticketNumber,
      marketType: w.kind,
      riskLevel,
      recommendedAction: result.action,
      reason: result.reason,
      inputs: {
        handle,
        liability,
        betCount,
        modelDrift: modelDrift > 0 ? modelDrift : undefined,
        moveCount: moveCount > 0 ? moveCount : undefined,
        lopsidedPct: lopsidedPct > 0 ? Math.round(lopsidedPct * 100) / 100 : undefined,
        hasPricingSnapshot: !!w.pricingSnapshot,
      },
      suggestedChanges: result.suggestedChanges,
      hedgeNotes: result.hedgeNotes,
    });
  }

  // Sort: critical first, then high, medium, low
  const riskOrder: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel] || b.inputs.liability - a.inputs.liability);

  return recommendations;
}

export async function generateHedgingOverview(): Promise<HedgingOverview> {
  const recommendations = await generateHedgingRecommendations();

  const countByRiskLevel: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalHandle = 0;
  let totalLiability = 0;

  for (const r of recommendations) {
    countByRiskLevel[r.riskLevel]++;
    totalHandle += r.inputs.handle;
    totalLiability += r.inputs.liability;
  }

  return {
    openMarketCount: recommendations.length,
    countByRiskLevel,
    totalHandle,
    totalLiability,
    highCriticalCount: countByRiskLevel.high + countByRiskLevel.critical,
  };
}
