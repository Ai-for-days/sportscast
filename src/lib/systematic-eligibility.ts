// ── Step 77: Systematic eligibility tagging ─────────────────────────────────
//
// Computes whether a signal qualifies as "systematicEligible" based on the
// Edge Validation segment verdicts (Step 76), the calibration metadata
// (Steps 70-71), and current strategy mode (Step 77).
//
// IMPORTANT: this is read-only labeling. It MUST NOT create candidates,
// submit orders, or change scoring. The returned object is metadata only.

import { buildEdgeValidationReport, type SegmentStats } from './edge-validation';
import { getStrategyMode, type StrategyMode } from './strategy-mode';

// Eligibility thresholds (Step 77 spec)
export const ELIGIBILITY_THRESHOLDS = {
  MIN_SAMPLE: 30,
  MIN_RELIABILITY: 0.60,
  MIN_CALIBRATED_EDGE: 0.03,
} as const;

export interface EligibilityContext {
  mode: StrategyMode;
  bySourceVerdict: Map<string, SegmentStats>;
  byConfidenceVerdict: Map<string, SegmentStats>;
}

let cached: { ctx: EligibilityContext; loadedAt: number } | null = null;
const CACHE_MS = 30_000;

export async function loadEligibilityContext(force = false): Promise<EligibilityContext | null> {
  const now = Date.now();
  if (!force && cached && now - cached.loadedAt < CACHE_MS) return cached.ctx;
  try {
    const [strategyCfg, report] = await Promise.all([
      getStrategyMode(),
      buildEdgeValidationReport({}),
    ]);
    const bySource = new Map<string, SegmentStats>();
    for (const s of report.bySource) bySource.set(s.segment, s);
    const byConfidence = new Map<string, SegmentStats>();
    for (const s of report.byConfidence) byConfidence.set(s.segment, s);
    const ctx: EligibilityContext = {
      mode: strategyCfg.mode,
      bySourceVerdict: bySource,
      byConfidenceVerdict: byConfidence,
    };
    cached = { ctx, loadedAt: now };
    return ctx;
  } catch {
    return null;
  }
}

export interface EligibilityResult {
  systematicEligible: boolean;
  systematicReason: string[];
  systematicMode: StrategyMode;
}

export interface SignalForEligibility {
  source: 'sportsbook' | 'kalshi';
  confidence: 'low' | 'medium' | 'high' | string;
  sizingTier: string;
  reliabilityFactor?: number;
  calibratedEdge?: number;
  riskLevel?: string;
  venueAdjustment?: { venueType?: 'indoor' | 'retractable' };
}

/**
 * Evaluate a signal against the 7 eligibility criteria.
 *
 * The function returns a result for ALL signals — `systematicReason` lists why
 * a signal is or isn't eligible so the UI can explain. Strategy mode does
 * NOT change eligibility computation; it only affects how the UI surfaces it.
 */
export function evaluateEligibility(
  signal: SignalForEligibility,
  ctx: EligibilityContext,
): EligibilityResult {
  const reasons: string[] = [];
  let eligible = true;

  // 1. Source segment verdict = Validated Edge
  const sourceSeg = ctx.bySourceVerdict.get(signal.source);
  if (!sourceSeg) {
    eligible = false;
    reasons.push(`No edge-validation data for source "${signal.source}" yet`);
  } else if (sourceSeg.verdict !== 'Validated Edge') {
    eligible = false;
    reasons.push(`Source "${signal.source}" verdict: ${sourceSeg.verdict} (need "Validated Edge")`);
  } else {
    reasons.push(`Source "${signal.source}" verdict: Validated Edge ✓`);
  }

  // 2. Sample size >= 30
  const decisive = sourceSeg ? sourceSeg.wins + sourceSeg.losses : 0;
  if (decisive < ELIGIBILITY_THRESHOLDS.MIN_SAMPLE) {
    eligible = false;
    reasons.push(`Source sample (${decisive}) below ${ELIGIBILITY_THRESHOLDS.MIN_SAMPLE} threshold`);
  } else {
    reasons.push(`Source sample ${decisive} ≥ ${ELIGIBILITY_THRESHOLDS.MIN_SAMPLE} ✓`);
  }

  // 3. reliabilityFactor >= 0.60
  if (signal.reliabilityFactor == null) {
    eligible = false;
    reasons.push('No reliabilityFactor on signal');
  } else if (signal.reliabilityFactor < ELIGIBILITY_THRESHOLDS.MIN_RELIABILITY) {
    eligible = false;
    reasons.push(`reliabilityFactor ${(signal.reliabilityFactor * 100).toFixed(0)}% below ${ELIGIBILITY_THRESHOLDS.MIN_RELIABILITY * 100}% threshold`);
  } else {
    reasons.push(`reliabilityFactor ${(signal.reliabilityFactor * 100).toFixed(0)}% ≥ ${ELIGIBILITY_THRESHOLDS.MIN_RELIABILITY * 100}% ✓`);
  }

  // 4. calibratedEdge >= 0.03
  if (signal.calibratedEdge == null) {
    eligible = false;
    reasons.push('No calibratedEdge on signal');
  } else if (signal.calibratedEdge < ELIGIBILITY_THRESHOLDS.MIN_CALIBRATED_EDGE) {
    eligible = false;
    reasons.push(`calibratedEdge ${(signal.calibratedEdge * 100).toFixed(2)}% below ${ELIGIBILITY_THRESHOLDS.MIN_CALIBRATED_EDGE * 100}% threshold`);
  } else {
    reasons.push(`calibratedEdge ${(signal.calibratedEdge * 100).toFixed(2)}% ≥ ${ELIGIBILITY_THRESHOLDS.MIN_CALIBRATED_EDGE * 100}% ✓`);
  }

  // 5. sizingTier not no-trade
  if (signal.sizingTier === 'no-trade') {
    eligible = false;
    reasons.push('sizingTier = no-trade');
  } else {
    reasons.push(`sizingTier = ${signal.sizingTier} ✓`);
  }

  // 6. No critical venue/indoor warning
  if (signal.venueAdjustment?.venueType === 'indoor') {
    eligible = false;
    reasons.push('Indoor venue — weather impact limited');
  } else if (signal.venueAdjustment?.venueType === 'retractable') {
    // Retractable is a warning, not a block — note it but don't disqualify
    reasons.push('Retractable roof: roof status uncertain (note only)');
  } else {
    reasons.push('No venue warning ✓');
  }

  // 7. No risk/health block
  if (signal.riskLevel === 'critical' || signal.riskLevel === 'high') {
    eligible = false;
    reasons.push(`riskLevel = ${signal.riskLevel}`);
  } else {
    reasons.push(`riskLevel = ${signal.riskLevel ?? 'low'} ✓`);
  }

  return {
    systematicEligible: eligible,
    systematicReason: reasons,
    systematicMode: ctx.mode,
  };
}
