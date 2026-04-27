// ── Step 87: Strategy operating scorecard + executive command view ──────────
//
// Consolidates signals → allocation → paper portfolio → pilot → review →
// decision implementation into one health view. Read-only across the entire
// strategy program: never auto-pauses pilots, never submits orders, never
// creates execution candidates, never auto-promotes strategies. Pure
// visibility, governance, and executive oversight.

import { generateRankedSignals, type RankedSignal } from './signal-ranking';
import { buildAllocationReport, type AllocationReport } from './portfolio-allocation';
import { buildStressTestReport, type StressTestReport } from './allocation-stress-test';
import { listPaperRecords, computePerformance, type PaperPerformance } from './paper-strategy-portfolio';
import { listStrategies, type StrategyRecord, type StrategyStatus } from './strategy-registry';
import { listPilots, computePilotMonitoring, type PilotPlan, type PilotMonitoring, type PilotStatus } from './strategy-pilot';
import { listReviews, type PilotReview } from './pilot-review';
import { listDecisions, computeSummary as computeDecisionSummary, type DecisionRecord, type DecisionSummary } from './pilot-decision-tracker';
import { buildCalibrationReport, type CalibrationReport } from './calibration-lab';

// ── Types ───────────────────────────────────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type ActionPriority = 'low' | 'medium' | 'high' | 'critical';
export type ActionCategory = 'edge' | 'allocation' | 'pilot' | 'governance' | 'ops';

export interface HealthScore {
  score: number;        // 0..100
  grade: Grade;
  reasons: string[];    // short bullet-style explanations of why this score landed where it did
  inputs: Record<string, number | string | null>; // raw numbers used to compute the score (for the UI)
}

export interface OverallStrategyHealth {
  score: number;
  grade: Grade;
  components: { name: string; weight: number; score: number }[];
}

export interface PipelineFunnel {
  signals: number;
  systematicEligible: number;
  allocated: number;
  capturedPaper: number;
  settledPaper: number;
  registeredStrategies: number;
  activePilots: number;
  completedReviews: number;
  completedDecisions: number;
}

export interface TopAction {
  id: string;
  priority: ActionPriority;
  category: ActionCategory;
  title: string;
  description: string;
  link: string;
  reason: string;
}

export interface StrategyScorecard {
  generatedAt: string;
  overall: OverallStrategyHealth;
  edgeHealth: HealthScore;
  allocationHealth: HealthScore;
  pilotHealth: HealthScore;
  governanceHealth: HealthScore;
  operationalHealth: HealthScore;
  pipelineFunnel: PipelineFunnel;
  pilotStatusDistribution: { status: PilotStatus; count: number }[];
  strategyStatusDistribution: { status: StrategyStatus; count: number }[];
  decisionSummary: DecisionSummary;
  operationalWarnings: string[];
  topActions: TopAction[];
  notes: string[];
}

// ── Component scoring ───────────────────────────────────────────────────────

function gradeOf(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function scoreEdge(calibration: CalibrationReport, signals: RankedSignal[]): HealthScore {
  const { summary, probabilityCalibration, segmentReliability } = calibration;
  const reasons: string[] = [];
  let score = 100;

  // Sample size
  const sampleSize = summary.withModelProb;
  if (sampleSize < 30) { score -= 35; reasons.push(`only ${sampleSize} resolved orders with model prob — insufficient evidence`); }
  else if (sampleSize < 100) { score -= 20; reasons.push(`${sampleSize} resolved orders is early-stage evidence`); }
  else if (sampleSize < 200) { score -= 10; reasons.push(`${sampleSize} resolved orders is moderate evidence`); }

  // Brier score (lower is better; coin-flip baseline = 0.25)
  if (summary.overallBrier == null) {
    score -= 15;
    reasons.push('no Brier score available yet (need resolved orders with model probability)');
  } else if (summary.overallBrier > 0.27) { score -= 30; reasons.push(`Brier ${summary.overallBrier.toFixed(3)} is worse than coin-flip baseline`); }
  else if (summary.overallBrier > 0.24) { score -= 15; reasons.push(`Brier ${summary.overallBrier.toFixed(3)} is at/near coin-flip baseline`); }
  else if (summary.overallBrier > 0.22) { score -= 5; reasons.push(`Brier ${summary.overallBrier.toFixed(3)} is modestly better than baseline`); }
  else reasons.push(`Brier ${summary.overallBrier.toFixed(3)} (lower is better)`);

  // Probability calibration: how many buckets miss observed vs predicted by >10pts
  const probMiss = probabilityCalibration.filter(b => b.evidence !== 'insufficient' && Math.abs(b.observedYesRate - b.predictedAvg) > 0.10).length;
  if (probMiss >= 3) { score -= 15; reasons.push(`${probMiss} probability buckets miss by >10pts`); }
  else if (probMiss >= 1) { score -= 7; reasons.push(`${probMiss} probability bucket miss by >10pts`); }

  // Overestimated segments (high Brier, sufficient evidence)
  const overestSegments = segmentReliability.filter(s => s.evidence !== 'insufficient' && (s.brierScore ?? 0) > 0.30).length;
  if (overestSegments >= 5) { score -= 15; reasons.push(`${overestSegments} segments with poor calibration (Brier > 0.30)`); }
  else if (overestSegments >= 2) { score -= 7; reasons.push(`${overestSegments} segments with poor calibration`); }

  // Validated edge count (signals where calibration adjusted positively or stayed positive)
  const validated = signals.filter(s => s.systematicEligible === true && (s.calibratedEdge ?? 0) > 0).length;
  if (validated === 0 && signals.length > 0) { score -= 10; reasons.push('no systematic-eligible signals with positive calibrated edge'); }
  else if (validated > 0) reasons.push(`${validated} systematic-eligible signals with positive calibrated edge`);

  score = Math.round(clamp(score));
  return {
    score,
    grade: gradeOf(score),
    reasons,
    inputs: {
      sampleSize,
      overallBrier: summary.overallBrier,
      probMiss,
      overestSegments,
      validated,
      signals: signals.length,
    },
  };
}

function scoreAllocation(allocation: AllocationReport, stress: StressTestReport): HealthScore {
  const reasons: string[] = [];
  let score = 100;

  const verdict = stress.verdict.verdict;
  if (verdict === 'Critical') { score -= 60; reasons.push(`stress verdict: Critical — ${stress.verdict.reason}`); }
  else if (verdict === 'Caution') { score -= 30; reasons.push(`stress verdict: Caution — ${stress.verdict.reason}`); }
  else if (verdict === 'Watch') { score -= 12; reasons.push(`stress verdict: Watch — ${stress.verdict.reason}`); }
  else reasons.push(`stress verdict: Healthy`);

  // Concentration: max single bucket pct (city / date / metric)
  const allBuckets = [
    ...stress.concentration.byCity,
    ...stress.concentration.byDate,
    ...stress.concentration.byMetric,
  ];
  const maxConc = allBuckets.reduce((m, b) => Math.max(m, b.pct ?? 0), 0);
  if (maxConc > 0.50) { score -= 20; reasons.push(`top concentration ${(maxConc * 100).toFixed(0)}% in one bucket (>50%)`); }
  else if (maxConc > 0.35) { score -= 10; reasons.push(`top concentration ${(maxConc * 100).toFixed(0)}% in one bucket`); }

  // Drawdown vs capital
  const capital = stress.config.bankrollCents;
  const meanDD = stress.monteCarlo.meanMaxDrawdownCents ?? 0;
  const ddPct = capital > 0 ? meanDD / capital : 0;
  if (ddPct > 0.30) { score -= 20; reasons.push(`mean Monte-Carlo drawdown ${(ddPct * 100).toFixed(0)}% of capital`); }
  else if (ddPct > 0.15) { score -= 10; reasons.push(`mean Monte-Carlo drawdown ${(ddPct * 100).toFixed(0)}% of capital`); }

  // Total exposure ratio
  const exposureRatio = capital > 0 ? allocation.summary.totalCappedExposureCents / capital : 0;
  if (exposureRatio > 0.95) { score -= 10; reasons.push(`exposure ${(exposureRatio * 100).toFixed(0)}% of bankroll (very high)`); }
  else if (exposureRatio < 0.05 && allocation.summary.totalEligible > 0) { score -= 5; reasons.push(`exposure only ${(exposureRatio * 100).toFixed(1)}% of bankroll despite ${allocation.summary.totalEligible} eligible signals`); }

  // Allocation warnings
  if (allocation.summary.warnings.length > 0) { score -= 5; reasons.push(`${allocation.summary.warnings.length} allocation warning(s)`); }

  if (allocation.summary.totalEligible === 0) {
    score = Math.min(score, 50);
    reasons.push('no systematic-eligible signals to allocate');
  }

  score = Math.round(clamp(score));
  return {
    score,
    grade: gradeOf(score),
    reasons,
    inputs: {
      verdict,
      maxConcentrationPct: Math.round(maxConc * 1000) / 10,
      meanDrawdownPctOfCapital: Math.round(ddPct * 1000) / 10,
      exposureRatioPct: Math.round(exposureRatio * 1000) / 10,
      eligibleSignals: allocation.summary.totalEligible,
      allocationWarnings: allocation.summary.warnings.length,
    },
  };
}

function scorePilot(pilots: PilotPlan[], monitoring: Map<string, PilotMonitoring>): HealthScore {
  const reasons: string[] = [];
  const active = pilots.filter(p => p.status === 'active');
  let score = 100;

  if (pilots.length === 0) {
    return {
      score: 60,
      grade: gradeOf(60),
      reasons: ['no pilots registered yet — health is neutral'],
      inputs: { active: 0, total: 0 },
    };
  }

  const breach = active.filter(p => monitoring.get(p.id)?.warningStatus === 'breach').length;
  const watch = active.filter(p => monitoring.get(p.id)?.warningStatus === 'watch').length;
  const inferredOnly = active.filter(p => monitoring.get(p.id)?.linkedVsInferred.monitoringMode === 'inferred').length;

  if (breach > 0) { score -= 35 * breach; reasons.push(`${breach} active pilot(s) in BREACH state`); }
  if (watch > 0) { score -= 10 * watch; reasons.push(`${watch} active pilot(s) in WATCH state`); }

  // ROI: weighted across active pilots that have settled trades
  let totalStake = 0;
  let totalPnl = 0;
  let totalDD = 0;
  let totalCap = 0;
  for (const p of active) {
    const m = monitoring.get(p.id);
    if (!m) continue;
    totalStake += m.totalStakeCents;
    totalPnl += m.totalPnlCents;
    totalDD += m.maxDrawdownCents;
    totalCap += m.limits.maxCapitalCents;
  }
  const roiPct = totalStake > 0 ? (totalPnl / totalStake) * 100 : null;
  if (roiPct != null) {
    if (roiPct < -10) { score -= 20; reasons.push(`aggregate active-pilot ROI ${roiPct.toFixed(1)}% (negative)`); }
    else if (roiPct < 0) { score -= 10; reasons.push(`aggregate active-pilot ROI ${roiPct.toFixed(1)}%`); }
    else reasons.push(`aggregate active-pilot ROI ${roiPct.toFixed(1)}%`);
  }
  const ddPct = totalCap > 0 ? totalDD / totalCap : 0;
  if (ddPct > 0.20) { score -= 15; reasons.push(`drawdown ${(ddPct * 100).toFixed(0)}% of pilot capital`); }
  else if (ddPct > 0.10) { score -= 7; reasons.push(`drawdown ${(ddPct * 100).toFixed(0)}% of pilot capital`); }

  // Linked vs inferred
  if (inferredOnly > 0 && active.length > 0) {
    score -= Math.min(15, inferredOnly * 5);
    reasons.push(`${inferredOnly}/${active.length} active pilot(s) only have inferred records (no linked orders)`);
  }

  if (active.length === 0 && pilots.length > 0) {
    score = Math.min(score, 70);
    reasons.push(`${pilots.length} pilot(s) registered but none active`);
  }

  score = Math.round(clamp(score));
  return {
    score,
    grade: gradeOf(score),
    reasons,
    inputs: {
      total: pilots.length,
      active: active.length,
      breach,
      watch,
      inferredOnly,
      aggregateRoiPct: roiPct == null ? null : Math.round(roiPct * 10) / 10,
      drawdownPctOfCapital: Math.round(ddPct * 1000) / 10,
    },
  };
}

function scoreGovernance(
  decisions: DecisionRecord[],
  decisionSummary: DecisionSummary,
  reviews: PilotReview[],
  strategies: StrategyRecord[],
  pilots: PilotPlan[],
): HealthScore {
  const reasons: string[] = [];
  let score = 100;

  // Overdue decisions
  if (decisionSummary.overdueCount > 0) {
    score -= Math.min(40, 10 * decisionSummary.overdueCount);
    reasons.push(`${decisionSummary.overdueCount} overdue pilot decision(s)`);
  }

  // Open decisions piling up
  const open = decisionSummary.byStatus.open + decisionSummary.byStatus.in_progress;
  if (open > 10) { score -= 15; reasons.push(`${open} unresolved pilot decisions`); }
  else if (open > 5) { score -= 7; reasons.push(`${open} unresolved pilot decisions`); }

  // Active pilots without any review
  const reviewedPilotIds = new Set(reviews.map(r => r.pilotId));
  const activePilots = pilots.filter(p => p.status === 'active');
  const unreviewed = activePilots.filter(p => !reviewedPilotIds.has(p.id));
  if (unreviewed.length > 0) {
    score -= Math.min(20, 7 * unreviewed.length);
    reasons.push(`${unreviewed.length} active pilot(s) with no review yet`);
  }

  // Draft reviews not completed
  const draftReviews = reviews.filter(r => r.status === 'draft');
  if (draftReviews.length > 0) {
    score -= Math.min(10, 3 * draftReviews.length);
    reasons.push(`${draftReviews.length} draft review(s) not completed`);
  }

  // Strategies in pilot_ready waiting for decision
  const pilotReady = strategies.filter(s => s.status === 'pilot_ready').length;
  const pilotReadyWithoutPilot = strategies.filter(s =>
    s.status === 'pilot_ready' && !pilots.some(p => p.strategyId === s.id),
  ).length;
  if (pilotReadyWithoutPilot > 0) {
    score -= Math.min(15, 5 * pilotReadyWithoutPilot);
    reasons.push(`${pilotReadyWithoutPilot} pilot_ready strategy/strategies with no pilot launched`);
  }

  // Acceptance rate signal
  if (decisionSummary.acceptanceRatePct != null) {
    reasons.push(`acceptance rate ${decisionSummary.acceptanceRatePct}% (excludes deferred)`);
  }

  score = Math.round(clamp(score));
  return {
    score,
    grade: gradeOf(score),
    reasons,
    inputs: {
      overdueDecisions: decisionSummary.overdueCount,
      openDecisions: open,
      unreviewedActivePilots: unreviewed.length,
      draftReviews: draftReviews.length,
      pilotReadyStrategies: pilotReady,
      pilotReadyWithoutPilot,
      acceptanceRatePct: decisionSummary.acceptanceRatePct,
    },
  };
}

function scoreOperational(
  paperPerf: PaperPerformance,
  allocation: AllocationReport,
): HealthScore {
  const reasons: string[] = [];
  let score = 100;

  // Paper sample size
  if (paperPerf.totals.captured === 0) {
    score -= 20;
    reasons.push('no paper portfolio records captured yet');
  } else if (paperPerf.totals.settled < 30) {
    score -= 10;
    reasons.push(`only ${paperPerf.totals.settled} settled paper records (need 30+ for meaningful evaluation)`);
  } else {
    reasons.push(`${paperPerf.totals.settled} settled paper records`);
  }

  // Open positions stale-ish (no settled lately): use ratio of open vs total
  if (paperPerf.totals.captured > 0) {
    const openRatio = paperPerf.totals.open / paperPerf.totals.captured;
    if (openRatio > 0.80 && paperPerf.totals.captured > 20) {
      score -= 10;
      reasons.push(`${(openRatio * 100).toFixed(0)}% of paper records still open — outcomes may need refresh`);
    }
  }

  // Allocation warnings
  if (allocation.summary.warnings.length >= 5) { score -= 10; reasons.push(`${allocation.summary.warnings.length} allocation warnings`); }
  else if (allocation.summary.warnings.length > 0) { score -= 3; }

  score = Math.round(clamp(score));
  return {
    score,
    grade: gradeOf(score),
    reasons,
    inputs: {
      paperCaptured: paperPerf.totals.captured,
      paperOpen: paperPerf.totals.open,
      paperSettled: paperPerf.totals.settled,
      allocationWarnings: allocation.summary.warnings.length,
    },
  };
}

// ── Top actions engine ──────────────────────────────────────────────────────

function generateTopActions(input: {
  edgeHealth: HealthScore;
  allocationHealth: HealthScore;
  pilotHealth: HealthScore;
  governanceHealth: HealthScore;
  operationalHealth: HealthScore;
  pilots: PilotPlan[];
  monitoring: Map<string, PilotMonitoring>;
  reviews: PilotReview[];
  decisions: DecisionRecord[];
  decisionSummary: DecisionSummary;
  strategies: StrategyRecord[];
  paperPerf: PaperPerformance;
  allocation: AllocationReport;
  stress: StressTestReport;
  signals: RankedSignal[];
}): TopAction[] {
  const out: TopAction[] = [];
  const {
    edgeHealth, allocationHealth, pilotHealth, governanceHealth, operationalHealth,
    pilots, monitoring, reviews, decisionSummary, strategies, paperPerf, allocation, stress, signals,
  } = input;

  // ── Critical / high: governance ────────────────────────────────────────────
  if (decisionSummary.overdueCount > 0) {
    out.push({
      id: 'gov:overdue-decisions',
      priority: decisionSummary.overdueCount >= 3 ? 'critical' : 'high',
      category: 'governance',
      title: `Resolve ${decisionSummary.overdueCount} overdue pilot decision${decisionSummary.overdueCount === 1 ? '' : 's'}`,
      description: 'Operator decisions past their due date undermine the credibility of the go/no-go program.',
      link: '/admin/system/pilot-decisions',
      reason: `pilot-decision-tracker reports ${decisionSummary.overdueCount} record(s) past dueDate`,
    });
  }

  // ── Pilot warnings ────────────────────────────────────────────────────────
  for (const p of pilots.filter(p => p.status === 'active')) {
    const m = monitoring.get(p.id);
    if (!m) continue;
    if (m.warningStatus === 'breach') {
      out.push({
        id: `pilot:breach:${p.id}`,
        priority: 'critical',
        category: 'pilot',
        title: `Active pilot in BREACH: ${p.strategyName}`,
        description: `Limits exceeded — ${m.breaches.slice(0, 2).join('; ')}${m.breaches.length > 2 ? '…' : ''}`,
        link: `/admin/system/strategy-pilot?pilotId=${encodeURIComponent(p.id)}`,
        reason: `${m.breaches.length} breach(es) detected by pilot monitoring`,
      });
    } else if (m.warningStatus === 'watch') {
      out.push({
        id: `pilot:watch:${p.id}`,
        priority: 'high',
        category: 'pilot',
        title: `Review active pilot with WATCH warning: ${p.strategyName}`,
        description: `One or more limits at >75% utilization. Investigate before it escalates to breach.`,
        link: `/admin/system/strategy-pilot?pilotId=${encodeURIComponent(p.id)}`,
        reason: 'utilization above watch threshold',
      });
    }
  }

  // ── Stress test verdict ───────────────────────────────────────────────────
  if (stress.verdict.verdict === 'Critical') {
    out.push({
      id: 'alloc:stress-critical',
      priority: 'critical',
      category: 'allocation',
      title: 'Allocation stress test verdict: Critical',
      description: stress.verdict.reason,
      link: '/admin/system/allocation-stress-test',
      reason: 'classifyVerdict() returned Critical',
    });
  } else if (stress.verdict.verdict === 'Caution') {
    out.push({
      id: 'alloc:stress-caution',
      priority: 'high',
      category: 'allocation',
      title: 'Allocation stress test verdict: Caution',
      description: stress.verdict.reason,
      link: '/admin/system/allocation-stress-test',
      reason: 'classifyVerdict() returned Caution',
    });
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  const reviewedPilotIds = new Set(reviews.map(r => r.pilotId));
  const activeWithoutReview = pilots.filter(p => p.status === 'active' && !reviewedPilotIds.has(p.id));
  for (const p of activeWithoutReview.slice(0, 3)) {
    out.push({
      id: `gov:no-review:${p.id}`,
      priority: 'high',
      category: 'governance',
      title: `Complete go/no-go review for active pilot: ${p.strategyName}`,
      description: 'Active pilot has never been reviewed. Generate a draft review and complete it.',
      link: `/admin/system/pilot-review?pilotId=${encodeURIComponent(p.id)}`,
      reason: 'no PilotReview record exists for this pilot',
    });
  }

  const draftReviews = reviews.filter(r => r.status === 'draft');
  if (draftReviews.length > 0) {
    out.push({
      id: 'gov:draft-reviews',
      priority: 'medium',
      category: 'governance',
      title: `Complete ${draftReviews.length} draft review${draftReviews.length === 1 ? '' : 's'}`,
      description: 'Draft reviews record analysis but do not produce a recommendation until completed.',
      link: '/admin/system/pilot-review',
      reason: 'PilotReview.status === "draft"',
    });
  }

  // ── Promotions waiting ────────────────────────────────────────────────────
  const pilotReadyWithoutPilot = strategies.filter(s =>
    s.status === 'pilot_ready' && !pilots.some(p => p.strategyId === s.id),
  );
  if (pilotReadyWithoutPilot.length > 0) {
    out.push({
      id: 'gov:pilot-ready-no-pilot',
      priority: 'medium',
      category: 'governance',
      title: `${pilotReadyWithoutPilot.length} pilot_ready strateg${pilotReadyWithoutPilot.length === 1 ? 'y' : 'ies'} without a pilot launched`,
      description: 'Strategy is approved for piloting but no pilot has been planned. Either launch one or move it back to paper_approved.',
      link: '/admin/system/strategy-registry',
      reason: 'strategy.status === "pilot_ready" but no PilotPlan references its strategyId',
    });
  }

  // ── Operational ───────────────────────────────────────────────────────────
  if (paperPerf.totals.captured === 0) {
    out.push({
      id: 'ops:capture-paper',
      priority: 'medium',
      category: 'ops',
      title: 'Capture current allocation as paper portfolio',
      description: 'No paper records yet — without a paper portfolio you cannot evaluate strategies before promoting them.',
      link: '/admin/system/paper-strategy-portfolio',
      reason: 'listPaperRecords() empty',
    });
  } else if (paperPerf.totals.captured > 0 && paperPerf.totals.open / paperPerf.totals.captured > 0.80) {
    out.push({
      id: 'ops:refresh-paper',
      priority: 'medium',
      category: 'ops',
      title: 'Refresh paper portfolio outcomes',
      description: `${paperPerf.totals.open} of ${paperPerf.totals.captured} records still open. Run "Refresh outcomes" to mark settled trades.`,
      link: '/admin/system/paper-strategy-portfolio',
      reason: 'open ratio > 80%',
    });
  }

  // ── Edge ──────────────────────────────────────────────────────────────────
  if ((edgeHealth.inputs.sampleSize as number) < 30) {
    out.push({
      id: 'edge:insufficient-evidence',
      priority: 'medium',
      category: 'edge',
      title: 'Do not promote any strategy: sample size insufficient',
      description: 'Calibration lab has fewer than 30 resolved orders with model probability — promotion decisions need more data.',
      link: '/admin/system/calibration-lab',
      reason: 'CalibrationReport.summary.withModelProb < 30',
    });
  }

  if (allocation.summary.totalEligible === 0 && signals.length > 0) {
    out.push({
      id: 'edge:no-eligible',
      priority: 'low',
      category: 'edge',
      title: 'No systematic-eligible signals',
      description: `${signals.length} signal(s) ranked but none cleared eligibility. Review thresholds and calibration filters.`,
      link: '/admin/system/strategy-mode',
      reason: 'all signals filtered out by systematic eligibility',
    });
  }

  // ── Allocation: stale stress test reminder ────────────────────────────────
  if (allocation.summary.totalEligible > 0 && stress.allocationSummary.signals === 0) {
    out.push({
      id: 'alloc:run-stress',
      priority: 'low',
      category: 'allocation',
      title: 'Run allocation stress test',
      description: 'Eligible signals exist but the stress test has no positions — re-run after refreshing allocation.',
      link: '/admin/system/allocation-stress-test',
      reason: 'allocation has signals but stress report has zero positions',
    });
  }

  // ── Operator follow-through reminder when scores low ──────────────────────
  if (governanceHealth.score < 60) {
    out.push({
      id: 'gov:overall-low',
      priority: 'medium',
      category: 'governance',
      title: 'Governance health below 60 — review backlog',
      description: 'Open decisions, draft reviews, and unreviewed pilots have accumulated. Spend a session clearing the queue.',
      link: '/admin/system/pilot-decisions',
      reason: `governance score ${governanceHealth.score}`,
    });
  }
  if (allocationHealth.score < 60) {
    out.push({
      id: 'alloc:overall-low',
      priority: 'medium',
      category: 'allocation',
      title: 'Allocation health below 60 — review allocation + stress',
      description: 'Stress verdict, concentration, or drawdown is below the comfort line.',
      link: '/admin/system/portfolio-allocation',
      reason: `allocation score ${allocationHealth.score}`,
    });
  }
  if (pilotHealth.score < 60) {
    out.push({
      id: 'pilot:overall-low',
      priority: 'medium',
      category: 'pilot',
      title: 'Pilot health below 60 — investigate active pilots',
      description: 'Aggregate ROI, drawdown, or warning status is poor across the active pilot fleet.',
      link: '/admin/system/strategy-pilot',
      reason: `pilot score ${pilotHealth.score}`,
    });
  }
  if (edgeHealth.score < 60) {
    out.push({
      id: 'edge:overall-low',
      priority: 'medium',
      category: 'edge',
      title: 'Edge health below 60 — revisit calibration',
      description: 'Brier, sample size, or segment reliability is weak. Tighten filters or wait for more evidence.',
      link: '/admin/system/calibration-lab',
      reason: `edge score ${edgeHealth.score}`,
    });
  }
  if (operationalHealth.score < 60) {
    out.push({
      id: 'ops:overall-low',
      priority: 'low',
      category: 'ops',
      title: 'Operational health below 60',
      description: 'Paper portfolio or allocation warnings need attention before relying on signal output.',
      link: '/admin/system/paper-strategy-portfolio',
      reason: `operational score ${operationalHealth.score}`,
    });
  }

  // De-dupe by id, sort by priority desc, take top 12
  const seen = new Set<string>();
  const deduped: TopAction[] = [];
  for (const a of out) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    deduped.push(a);
  }
  const priorityRank: Record<ActionPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  deduped.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]);
  return deduped.slice(0, 12);
}

// ── Operational warnings (free-form) ────────────────────────────────────────

function buildOperationalWarnings(input: {
  pilots: PilotPlan[];
  monitoring: Map<string, PilotMonitoring>;
  decisionSummary: DecisionSummary;
  allocation: AllocationReport;
  stress: StressTestReport;
}): string[] {
  const w: string[] = [];
  const { pilots, monitoring, decisionSummary, allocation, stress } = input;

  for (const p of pilots.filter(p => p.status === 'active')) {
    const m = monitoring.get(p.id);
    if (m?.warningStatus === 'breach') w.push(`Pilot ${p.strategyName} (${p.id}) in BREACH`);
    else if (m?.warningStatus === 'watch') w.push(`Pilot ${p.strategyName} (${p.id}) in WATCH`);
  }
  if (decisionSummary.overdueCount > 0) w.push(`${decisionSummary.overdueCount} overdue pilot decision(s)`);
  if (stress.verdict.verdict === 'Critical' || stress.verdict.verdict === 'Caution') {
    w.push(`Allocation stress: ${stress.verdict.verdict} — ${stress.verdict.reason}`);
  }
  for (const aw of allocation.summary.warnings) w.push(`Allocation: ${aw}`);
  return w;
}

// ── Main builder ────────────────────────────────────────────────────────────

export async function buildScorecard(): Promise<StrategyScorecard> {
  const [signals, allocation, stress, paperRecords, strategies, pilots, reviews, decisions, calibration] = await Promise.all([
    generateRankedSignals(),
    buildAllocationReport(),
    buildStressTestReport(),
    listPaperRecords(2000),
    listStrategies(200),
    listPilots(200),
    listReviews(500),
    listDecisions(2000),
    buildCalibrationReport(),
  ]);

  const paperPerf = computePerformance(paperRecords);
  const decisionSummary = computeDecisionSummary(decisions);

  // Pilot monitoring snapshots (only active to keep this fast)
  const monitoring = new Map<string, PilotMonitoring>();
  await Promise.all(
    pilots.filter(p => p.status === 'active').map(async p => {
      try {
        const m = await computePilotMonitoring(p);
        monitoring.set(p.id, m);
      } catch {
        // ignore individual pilot monitoring failures — scorecard is still useful
      }
    }),
  );

  const edgeHealth = scoreEdge(calibration, signals);
  const allocationHealth = scoreAllocation(allocation, stress);
  const pilotHealth = scorePilot(pilots, monitoring);
  const governanceHealth = scoreGovernance(decisions, decisionSummary, reviews, strategies, pilots);
  const operationalHealth = scoreOperational(paperPerf, allocation);

  // Overall: weighted combination. Edge + allocation are the foundations.
  const components = [
    { name: 'Edge',          weight: 0.30, score: edgeHealth.score },
    { name: 'Allocation',    weight: 0.25, score: allocationHealth.score },
    { name: 'Pilot',         weight: 0.20, score: pilotHealth.score },
    { name: 'Governance',    weight: 0.15, score: governanceHealth.score },
    { name: 'Operational',   weight: 0.10, score: operationalHealth.score },
  ];
  const overallScore = Math.round(components.reduce((s, c) => s + c.weight * c.score, 0));

  // Pipeline funnel
  const settledPaper = paperRecords.filter(r => r.status === 'settled').length;
  const capturedPaper = paperRecords.length;
  const allocated = allocation.records.filter(r => r.cappedStakeCents > 0).length;
  const systematicEligible = signals.filter(s => s.systematicEligible === true).length;
  const activePilots = pilots.filter(p => p.status === 'active').length;
  const completedReviews = reviews.filter(r => r.status === 'completed').length;
  const completedDecisions = decisions.filter(d => d.status === 'completed').length;

  const pipelineFunnel: PipelineFunnel = {
    signals: signals.length,
    systematicEligible,
    allocated,
    capturedPaper,
    settledPaper,
    registeredStrategies: strategies.length,
    activePilots,
    completedReviews,
    completedDecisions,
  };

  // Pilot status distribution
  const pilotStatusDistribution: { status: PilotStatus; count: number }[] = [];
  const pilotStatusCounts: Record<string, number> = {};
  for (const p of pilots) pilotStatusCounts[p.status] = (pilotStatusCounts[p.status] ?? 0) + 1;
  for (const [status, count] of Object.entries(pilotStatusCounts)) {
    pilotStatusDistribution.push({ status: status as PilotStatus, count });
  }

  // Strategy status distribution
  const strategyStatusDistribution: { status: StrategyStatus; count: number }[] = [];
  const stratStatusCounts: Record<string, number> = {};
  for (const s of strategies) stratStatusCounts[s.status] = (stratStatusCounts[s.status] ?? 0) + 1;
  for (const [status, count] of Object.entries(stratStatusCounts)) {
    strategyStatusDistribution.push({ status: status as StrategyStatus, count });
  }

  const operationalWarnings = buildOperationalWarnings({ pilots, monitoring, decisionSummary, allocation, stress });

  const topActions = generateTopActions({
    edgeHealth, allocationHealth, pilotHealth, governanceHealth, operationalHealth,
    pilots, monitoring, reviews, decisions, decisionSummary, strategies,
    paperPerf, allocation, stress, signals,
  });

  return {
    generatedAt: new Date().toISOString(),
    overall: { score: overallScore, grade: gradeOf(overallScore), components },
    edgeHealth,
    allocationHealth,
    pilotHealth,
    governanceHealth,
    operationalHealth,
    pipelineFunnel,
    pilotStatusDistribution,
    strategyStatusDistribution,
    decisionSummary,
    operationalWarnings,
    topActions,
    notes: [
      'Step 87 is purely visibility, governance, and executive oversight. No autonomous trading, no order submission, no execution candidate creation, no pilot state changes, no automatic strategy promotion.',
      'Health scores are 0–100 with a letter grade (A=90+, B=75+, C=60+, D=40+, F<40). Components are: Edge (30%), Allocation (25%), Pilot (20%), Governance (15%), Operational (10%).',
      'Pilot monitoring snapshots are computed only for active pilots to keep scorecard generation fast.',
      'Top actions are ranked by priority (critical > high > medium > low). Capped at 12 per scorecard.',
    ],
  };
}
