// ── Step 81: Strategy comparison + promotion readiness ─────────────────────
//
// Compares several strategy variants on the same resolved trade pool plus the
// Step 80 paper portfolio, and produces a promotion-readiness verdict for
// each. Read-only research layer — no autonomous trading, no order submission,
// no execution candidate creation, no automatic promotion. Verdicts are
// recommendations for operator review.

import { getRedis } from './redis';
import { loadCalibrationContext, calibrateSignal } from './signal-calibration';
import { buildStressTestReport, type RiskVerdict } from './allocation-stress-test';
import { buildEdgeValidationReport } from './edge-validation';
import { listPaperRecords, computePerformance } from './paper-strategy-portfolio';
import { evidenceLevel, evidenceLabel } from './calibration-lab';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Common record pool ──────────────────────────────────────────────────────
//
// Uses the same Redis tables as calibration-backtest / outcome-evaluation.
// Recomputes calibratedEdge + reliabilityFactor against current calibration
// history so apples-to-apples comparisons across variants are possible.

interface ResolvedTrade {
  orderId: string;
  ticker?: string;
  side?: 'yes' | 'no';
  source?: 'kalshi' | 'sportsbook';
  rawEdge?: number;
  calibratedEdge?: number;
  reliabilityFactor?: number;
  modelProbForSide?: number;
  marketProbForSide?: number;
  locationName?: string;
  metric?: string;
  forecastSource?: string;
  leadTimeHours?: number;
  timestamp?: number;
  pnlCents?: number;
  costBasisCents?: number;
  outcomeYes?: 0 | 1;
}

export interface ComparisonFilters {
  dateFrom?: string;
  dateTo?: string;
  source?: 'kalshi' | 'sportsbook';
  metric?: string;
  mode?: 'all' | 'demo' | 'live';
  minSampleSize?: number;
}

async function loadResolvedPool(filters: ComparisonFilters): Promise<ResolvedTrade[]> {
  const redis = getRedis();
  const sources: ('demo' | 'live')[] =
    filters.mode === 'demo' ? ['demo'] :
    filters.mode === 'live' ? ['live'] : ['demo', 'live'];

  const orders: any[] = [];
  for (const s of sources) {
    const setKey = `kalshi:${s}:orders`;
    const total = await redis.zcard(setKey);
    if (total === 0) continue;
    const ids = await redis.zrange(setKey, 0, Math.min(total, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`kalshi:${s}:order:${id}`);
      if (raw) orders.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
    }
  }

  const candCount = await redis.zcard('exec:candidates:all');
  const candidates: Record<string, any> = {};
  if (candCount > 0) {
    const ids = await redis.zrange('exec:candidates:all', 0, Math.min(candCount, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`exec:candidate:${id}`);
      if (raw) {
        const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
        candidates[c.id] = c;
      }
    }
  }

  const settCount = await redis.zcard('settlements:all');
  const settBy = new Map<string, any>();
  if (settCount > 0) {
    const ids = await redis.zrange('settlements:all', 0, Math.min(settCount, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`settlement:${id}`);
      if (raw) {
        const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (s.orderId) settBy.set(s.orderId, s);
      }
    }
  }

  const dateFromMs = filters.dateFrom ? new Date(filters.dateFrom).getTime() : undefined;
  const dateToMs   = filters.dateTo   ? new Date(filters.dateTo).getTime() + DAY_MS - 1 : undefined;

  let calibrationCtx;
  try { calibrationCtx = await loadCalibrationContext(); } catch { calibrationCtx = null; }

  const out: ResolvedTrade[] = [];
  for (const o of orders) {
    const cand = o.candidateId ? candidates[o.candidateId] : undefined;
    const sett = settBy.get(o.id);
    const ts = (o.timestamp ?? o.createdAt) as number | undefined;
    if (dateFromMs != null && (ts == null || ts < dateFromMs)) continue;
    if (dateToMs   != null && (ts == null || ts > dateToMs))   continue;
    if (filters.source && cand?.source !== filters.source) continue;
    if (filters.metric && cand?.metric !== filters.metric) continue;

    const side = o.side as 'yes' | 'no' | undefined;
    const modelProbForSide = side === 'yes' ? cand?.marketSnapshot?.modelProbYes : side === 'no' ? cand?.marketSnapshot?.modelProbNo : undefined;
    const marketProbForSide = side === 'yes' ? cand?.marketSnapshot?.marketProbYes : side === 'no' ? cand?.marketSnapshot?.marketProbNo : undefined;
    const rawEdge = cand?.edge;

    const leadTimeHours = (() => {
      if (!cand?.targetDate || !ts) return undefined;
      const t = new Date(`${cand.targetDate}T12:00:00Z`).getTime();
      return Number.isNaN(t) ? undefined : Math.max(0, (t - ts) / 3_600_000);
    })();

    let calibratedEdge: number | undefined;
    let reliabilityFactor: number | undefined;
    if (calibrationCtx && rawEdge != null) {
      const cal = calibrateSignal({
        rawEdge: Math.abs(rawEdge),
        modelProbForSide, side, leadTimeHours,
      }, calibrationCtx);
      calibratedEdge = cal.calibratedEdge;
      reliabilityFactor = cal.reliabilityFactor;
    }

    const pnlCents: number | undefined = sett?.netPnlCents;
    const costBasisCents: number | undefined = (o as any).costBasisCents
      ?? (o as any).maxNotionalCents
      ?? (o as any).stakeCents
      ?? sett?.costBasisCents;

    let outcomeYes: 0 | 1 | undefined;
    if (pnlCents != null && pnlCents !== 0 && side) {
      outcomeYes = ((side === 'yes') === (pnlCents > 0)) ? 1 : 0;
    }

    out.push({
      orderId: o.id,
      ticker: o.ticker,
      side,
      source: cand?.source as any,
      rawEdge,
      calibratedEdge,
      reliabilityFactor,
      modelProbForSide,
      marketProbForSide,
      locationName: cand?.locationName,
      metric: cand?.metric,
      forecastSource: cand?.forecastSource ?? cand?.source,
      leadTimeHours,
      timestamp: ts,
      pnlCents,
      costBasisCents,
      outcomeYes,
    });
  }
  return out;
}

// ── Variant definitions ─────────────────────────────────────────────────────

export interface VariantFilters {
  minCalibratedEdge?: number;
  minReliability?: number;
  minSampleSize?: number;
  allowedSources?: string[];
  allowedMetrics?: string[];
  allowedHorizonBuckets?: string[];
}

const VARIANT_DEFS: { id: string; name: string; description: string; mode: string; filters: VariantFilters; predicate: (t: ResolvedTrade) => boolean }[] = [
  {
    id: 'raw-edge',
    name: 'Raw-edge strategy',
    description: 'Take every settled trade exactly as it was placed. No calibration filter. Baseline.',
    mode: 'decision_support',
    filters: {},
    predicate: () => true,
  },
  {
    id: 'calibrated-edge',
    name: 'Calibrated-edge strategy',
    description: 'Exclude trades where the now-recomputed reliabilityFactor is below the Step 71 no-trade cap (0.25).',
    mode: 'operator_approved',
    filters: { minReliability: 0.25 },
    predicate: t => (t.reliabilityFactor ?? 1) >= 0.25,
  },
  {
    id: 'systematic-eligible',
    name: 'Systematic-eligible strategy',
    description: 'Apply the full Step 77 eligibility test: reliability >= 0.60 AND calibratedEdge >= 0.03.',
    mode: 'systematic_research',
    filters: { minReliability: 0.60, minCalibratedEdge: 0.03 },
    predicate: t => (t.reliabilityFactor ?? 0) >= 0.60 && (t.calibratedEdge ?? 0) >= 0.03,
  },
];

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface VariantMetrics {
  totalSignals: number;          // total trades in pool that match the filter
  eligibleSignals: number;       // alias of totalSignals for API parity
  capturedPaperTrades: number;
  settledPaperTrades: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  winRatePct: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
  totalStakeCents: number;
  avgStakeCents: number | null;
  roiPct: number | null;
  maxDrawdownCents: number;
  sharpeLike: number | null;
  avgCalibratedEdge: number | null;
  avgReliabilityFactor: number | null;
  evidence: ReturnType<typeof evidenceLevel>;
  evidenceLabel: string;
}

function metricsFor(trades: ResolvedTrade[], paperCaptured: number, paperSettled: number): VariantMetrics {
  const settled = trades.filter(t => t.pnlCents != null);
  const wins = settled.filter(t => (t.pnlCents as number) > 0).length;
  const losses = settled.filter(t => (t.pnlCents as number) < 0).length;
  const pushes = settled.filter(t => (t.pnlCents as number) === 0).length;
  const totalPnl = settled.reduce((s, t) => s + (t.pnlCents as number), 0);
  const totalStake = settled.reduce((s, t) => s + (t.costBasisCents ?? 0), 0);
  const avgPnl = settled.length > 0 ? totalPnl / settled.length : null;

  // Drawdown — chronological replay
  const chrono = [...settled].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  let cum = 0, runMax = 0, maxDD = 0;
  for (const t of chrono) {
    cum += t.pnlCents as number;
    if (cum > runMax) runMax = cum;
    const dd = runMax - cum;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe-like
  let sharpe: number | null = null;
  if (settled.length >= 2 && avgPnl != null) {
    const variance = settled.reduce((s, t) => s + ((t.pnlCents as number) - avgPnl) ** 2, 0) / (settled.length - 1);
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? Math.round((avgPnl / std) * 100) / 100 : null;
  }

  const withCalEdge = trades.filter(t => t.calibratedEdge != null);
  const avgCalEdge = withCalEdge.length > 0
    ? Math.round((withCalEdge.reduce((s, t) => s + (t.calibratedEdge as number), 0) / withCalEdge.length) * 10000) / 10000
    : null;
  const withReliab = trades.filter(t => t.reliabilityFactor != null);
  const avgReliab = withReliab.length > 0
    ? Math.round((withReliab.reduce((s, t) => s + (t.reliabilityFactor as number), 0) / withReliab.length) * 1000) / 1000
    : null;

  const ev = evidenceLevel(settled.length);
  return {
    totalSignals: trades.length,
    eligibleSignals: trades.length,
    capturedPaperTrades: paperCaptured,
    settledPaperTrades: paperSettled,
    settled: settled.length,
    wins, losses, pushes,
    winRatePct: settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : null,
    totalPnlCents: totalPnl,
    avgPnlCents: avgPnl != null ? Math.round(avgPnl) : null,
    totalStakeCents: totalStake,
    avgStakeCents: settled.length > 0 ? Math.round(totalStake / settled.length) : null,
    roiPct: totalStake > 0 ? Math.round((totalPnl / totalStake) * 1000) / 10 : null,
    maxDrawdownCents: Math.round(maxDD),
    sharpeLike: sharpe,
    avgCalibratedEdge: avgCalEdge,
    avgReliabilityFactor: avgReliab,
    evidence: ev,
    evidenceLabel: evidenceLabel(ev),
  };
}

// ── Promotion verdict ───────────────────────────────────────────────────────

export type PromotionVerdict = 'not_ready' | 'watch' | 'promotion_candidate' | 'ready_for_pilot';

interface VerdictInput {
  m: VariantMetrics;
  bankrollCents: number;
  stressVerdict: RiskVerdict;
  edgeValidationVerdict: 'Validated Edge' | 'Overestimated' | 'Neutral' | 'Insufficient sample';
  hasConcentrationWarning: boolean;
}

function classifyPromotion(input: VerdictInput): { verdict: PromotionVerdict; reasons: string[] } {
  const { m, bankrollCents, stressVerdict, edgeValidationVerdict, hasConcentrationWarning } = input;
  const reasons: string[] = [];
  const ddPct = m.maxDrawdownCents / Math.max(1, bankrollCents);

  // Hard "not_ready" gates
  if (m.settled < 30) {
    reasons.push(`only ${m.settled} settled trades — need >= 30 to begin verdicting`);
    return { verdict: 'not_ready', reasons };
  }
  if (m.roiPct != null && m.roiPct < 0) {
    reasons.push(`negative ROI (${m.roiPct.toFixed(1)}%)`);
  }
  if (stressVerdict === 'Unsafe') {
    reasons.push('allocation stress test classifies the portfolio Unsafe');
  }
  if (ddPct > 0.40) {
    reasons.push(`max drawdown ${(ddPct * 100).toFixed(0)}% of bankroll exceeds 40% ceiling`);
  }
  if (m.avgReliabilityFactor != null && m.avgReliabilityFactor < 0.30) {
    reasons.push(`average reliabilityFactor ${(m.avgReliabilityFactor * 100).toFixed(0)}% — calibration history is too thin`);
  }
  if (reasons.length > 0) return { verdict: 'not_ready', reasons };

  // Candidate-grade: positive ROI, 100+ settled, stress not Unsafe/Risky-only-borderline,
  // edge validation not Overestimated, drawdown <= 25%, no critical operational concerns.
  const positiveROI = (m.roiPct ?? 0) > 0;
  const lotsOfSamples = m.settled >= 200;
  const enoughSamples = m.settled >= 100;
  const ddOK = ddPct <= 0.25;
  const ddTight = ddPct <= 0.15;

  if (lotsOfSamples && positiveROI && ddTight && stressVerdict === 'Healthy' && edgeValidationVerdict !== 'Overestimated' && !hasConcentrationWarning) {
    reasons.push(`${m.settled} settled trades`, `ROI ${m.roiPct?.toFixed(1)}%`, `drawdown ${(ddPct * 100).toFixed(0)}% (≤ 15%)`, 'stress=Healthy', `edge validation=${edgeValidationVerdict}`, 'no concentration warning');
    return { verdict: 'ready_for_pilot', reasons };
  }
  if (enoughSamples && positiveROI && ddOK && (stressVerdict === 'Healthy' || stressVerdict === 'Watch') && edgeValidationVerdict !== 'Overestimated') {
    reasons.push(`${m.settled} settled trades`, `ROI ${m.roiPct?.toFixed(1)}%`, `drawdown ${(ddPct * 100).toFixed(0)}%`, `stress=${stressVerdict}`, `edge validation=${edgeValidationVerdict}`);
    if (hasConcentrationWarning) reasons.push('concentration warning present (still candidate-eligible)');
    return { verdict: 'promotion_candidate', reasons };
  }

  // Watch: 30–99 settled, or stable but unstable signals
  if (m.settled < 100) reasons.push(`${m.settled} settled trades — early evidence only`);
  if (m.roiPct != null && m.roiPct < 1) reasons.push(`ROI ${m.roiPct.toFixed(1)}% is positive but thin`);
  if (stressVerdict === 'Watch' || stressVerdict === 'Risky') reasons.push(`stress verdict=${stressVerdict}`);
  if (hasConcentrationWarning) reasons.push('concentration warning');
  if (edgeValidationVerdict === 'Overestimated') reasons.push('edge validation: overestimated');
  if (reasons.length === 0) reasons.push('metrics are mixed; continue monitoring');
  return { verdict: 'watch', reasons };
}

// ── Top-level report ────────────────────────────────────────────────────────

export interface StrategyVariant {
  id: string;
  name: string;
  description: string;
  mode: string;
  filters: VariantFilters;
  metrics: VariantMetrics;
  verdict: PromotionVerdict;
  reasons: string[];
}

export interface StrategyComparisonReport {
  generatedAt: string;
  filters: ComparisonFilters;
  bankrollCents: number;
  stressVerdict: RiskVerdict;
  edgeValidationVerdict: string;
  hasConcentrationWarning: boolean;
  variants: StrategyVariant[];
  paper: {
    captured: number;
    settled: number;
    winRatePct: number | null;
    totalPnlCents: number;
    roiPct: number | null;
    maxDrawdownCents: number;
    verdict: PromotionVerdict;
    reasons: string[];
  };
  recommendation: { variantId: string; verdict: PromotionVerdict; rationale: string };
  notes: string[];
}

export async function buildStrategyComparisonReport(filters: ComparisonFilters = {}): Promise<StrategyComparisonReport> {
  const [pool, stressReport, edgeReport, paperRecords] = await Promise.all([
    loadResolvedPool(filters),
    buildStressTestReport({ simulations: 500 }),
    buildEdgeValidationReport({ dateFrom: filters.dateFrom, dateTo: filters.dateTo, source: filters.source, metric: filters.metric, mode: filters.mode }),
    listPaperRecords(2000),
  ]);

  const stressVerdict = stressReport.verdict.verdict as RiskVerdict;
  const edgeValidationVerdict = edgeReport.overall.verdict;
  const hasConcentrationWarning = (stressReport.concentration.byCity[0]?.pctOfPortfolio ?? 0) > 0.40
    || (stressReport.concentration.byDate[0]?.pctOfPortfolio ?? 0) > 0.40
    || (stressReport.concentration.byMetric[0]?.pctOfPortfolio ?? 0) > 0.40;
  const bankrollCents = stressReport.allocationSummary.bankrollCents;

  // Paper portfolio (Step 80)
  const paperPerf = computePerformance(paperRecords);
  const paperCaptured = paperPerf.totals.captured;
  const paperSettled = paperPerf.totals.settled;

  const variants: StrategyVariant[] = VARIANT_DEFS.map(def => {
    const subset = pool.filter(def.predicate);
    const m = metricsFor(subset, paperCaptured, paperSettled);
    const ver = classifyPromotion({ m, bankrollCents, stressVerdict, edgeValidationVerdict: edgeValidationVerdict as any, hasConcentrationWarning });
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      mode: def.mode,
      filters: def.filters,
      metrics: m,
      verdict: ver.verdict,
      reasons: ver.reasons,
    };
  });

  // Paper variant — evaluated separately (uses Step 80 numbers verbatim)
  const paperMetrics: VariantMetrics = {
    totalSignals: paperPerf.totals.captured,
    eligibleSignals: paperPerf.totals.captured,
    capturedPaperTrades: paperCaptured,
    settledPaperTrades: paperSettled,
    settled: paperPerf.totals.settled,
    wins: paperPerf.settled.wins,
    losses: paperPerf.settled.losses,
    pushes: paperPerf.settled.pushes,
    winRatePct: paperPerf.settled.winRatePct,
    totalPnlCents: paperPerf.settled.totalPnlCents,
    avgPnlCents: paperPerf.settled.avgPnlCents,
    totalStakeCents: paperPerf.settled.totalStakeCents,
    avgStakeCents: paperPerf.settled.totalStakeCents > 0 && paperPerf.totals.settled > 0
      ? Math.round(paperPerf.settled.totalStakeCents / paperPerf.totals.settled) : null,
    roiPct: paperPerf.settled.roiPct,
    maxDrawdownCents: paperPerf.drawdown.maxDrawdownCents,
    sharpeLike: null,
    avgCalibratedEdge: paperRecords.length > 0
      ? Math.round((paperRecords.reduce((s, r) => s + (r.calibratedEdge ?? 0), 0) / Math.max(1, paperRecords.filter(r => r.calibratedEdge != null).length)) * 10000) / 10000
      : null,
    avgReliabilityFactor: paperRecords.length > 0
      ? Math.round((paperRecords.reduce((s, r) => s + (r.reliabilityFactor ?? 0), 0) / Math.max(1, paperRecords.filter(r => r.reliabilityFactor != null).length)) * 1000) / 1000
      : null,
    evidence: evidenceLevel(paperPerf.totals.settled),
    evidenceLabel: evidenceLabel(evidenceLevel(paperPerf.totals.settled)),
  };
  const paperVerdict = classifyPromotion({ m: paperMetrics, bankrollCents, stressVerdict, edgeValidationVerdict: edgeValidationVerdict as any, hasConcentrationWarning });

  variants.push({
    id: 'paper-portfolio',
    name: 'Paper captured portfolio',
    description: 'Step 80 paper portfolio: actual sequence of captured systematic-eligible signals and their realized outcomes.',
    mode: 'systematic_research',
    filters: { minReliability: 0.60, minCalibratedEdge: 0.03 },
    metrics: paperMetrics,
    verdict: paperVerdict.verdict,
    reasons: paperVerdict.reasons,
  });

  // Recommendation: highest-quality verdict among variants, tie-broken by ROI then sample.
  const verdictRank: Record<PromotionVerdict, number> = { not_ready: 0, watch: 1, promotion_candidate: 2, ready_for_pilot: 3 };
  const recommended = [...variants].sort((a, b) => {
    if (verdictRank[b.verdict] !== verdictRank[a.verdict]) return verdictRank[b.verdict] - verdictRank[a.verdict];
    if ((b.metrics.roiPct ?? -Infinity) !== (a.metrics.roiPct ?? -Infinity)) return (b.metrics.roiPct ?? -Infinity) - (a.metrics.roiPct ?? -Infinity);
    return b.metrics.settled - a.metrics.settled;
  })[0];

  return {
    generatedAt: new Date().toISOString(),
    filters,
    bankrollCents,
    stressVerdict,
    edgeValidationVerdict,
    hasConcentrationWarning,
    variants,
    paper: {
      captured: paperCaptured,
      settled: paperSettled,
      winRatePct: paperPerf.settled.winRatePct,
      totalPnlCents: paperPerf.settled.totalPnlCents,
      roiPct: paperPerf.settled.roiPct,
      maxDrawdownCents: paperPerf.drawdown.maxDrawdownCents,
      verdict: paperVerdict.verdict,
      reasons: paperVerdict.reasons,
    },
    recommendation: {
      variantId: recommended.id,
      verdict: recommended.verdict,
      rationale: `${recommended.name}: ${recommended.reasons.join('; ')}`,
    },
    notes: [
      'Variants are evaluated on the SAME resolved-trade pool (orders + candidates + settlements). Filters control which trades enter each variant\'s metrics.',
      'Paper variant uses the actual Step 80 paper-portfolio records, not the synthetic pool — it reflects real capture timing and Step 78 caps.',
      'Promotion verdicts are operator recommendations only. No automatic promotion. Live trading remains a manual operator action.',
      'not_ready: <30 settled, negative ROI, Unsafe stress, drawdown >40% of bankroll, or insufficient calibration data.',
      'watch: 30–99 settled, or thin/unstable positive ROI, Watch/Risky stress, concentration warnings, or edge validation = Overestimated.',
      'promotion_candidate: ≥100 settled, positive ROI, drawdown ≤25% of bankroll, stress in {Healthy, Watch}, edge validation ≠ Overestimated.',
      'ready_for_pilot: ≥200 settled, positive ROI, drawdown ≤15% of bankroll, stress=Healthy, edge validation ≠ Overestimated, no concentration warnings.',
      'Nothing here is "proven." Sample size labels follow the Step 69/72 convention: <30=insufficient, 30–99=early, 100–199=moderate, 200+=stronger.',
    ],
  };
}
