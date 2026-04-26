// ── Step 79: Allocation simulation + drawdown stress testing ────────────────
//
// Tests whether the Step 78 allocation recommendations would survive realistic
// losing streaks, drawdowns, and correlated failures. Simulation only — no
// execution changes, no order submission, no candidate auto-creation.
//
// Two simulation modes:
//   1. Monte Carlo  — N independent draws using model probability per signal
//   2. Stress       — deterministic scenarios applied to point estimates
//
// Per-signal outcome model (Kalshi-style binary):
//   stake          = recommendedStakeCents (Step 78 capped)
//   p              = modelProbForSide        (defaults to 0.5 if missing)
//   m              = marketProbForSide       (defaults to 0.5 if missing)
//   payout-if-win  = stake × (1 - m) / m     (Kalshi YES at price m)
//   loss-if-lose   = -stake
//   E[P&L]         = p × payout − (1-p) × stake = stake × (p/m − 1)

import { buildAllocationReport, type AllocationRecord } from './portfolio-allocation';

// ── PRNG ────────────────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Per-signal economics ────────────────────────────────────────────────────

interface Position {
  stake: number;
  p: number;
  m: number;
  payoutIfWin: number;
  expectedPnl: number;
  varPnl: number;
  // Pass-through metadata for grouping
  city?: string;
  date?: string;
  metric?: string;
  source?: string;
  calibratedEdge?: number;
  reliabilityFactor?: number;
  signalId: string;
}

function asPosition(r: AllocationRecord): Position {
  const stake = r.cappedStakeCents;
  const p = r.modelProbForSide ?? 0.5;
  const m = r.marketProbForSide ?? 0.5;
  const payoutIfWin = m > 0 ? stake * (1 - m) / m : stake;
  const expectedPnl = p * payoutIfWin - (1 - p) * stake;
  // Per-trial variance: E[X²] − E[X]²
  const e1 = expectedPnl;
  const e2 = p * payoutIfWin ** 2 + (1 - p) * stake ** 2;
  const varPnl = Math.max(0, e2 - e1 * e1);
  return {
    stake,
    p,
    m,
    payoutIfWin,
    expectedPnl,
    varPnl,
    city: r.locationName,
    date: r.targetDate,
    metric: r.metric,
    source: r.source,
    calibratedEdge: r.calibratedEdge,
    reliabilityFactor: r.reliabilityFactor,
    signalId: r.signalId,
  };
}

// ── Monte Carlo ─────────────────────────────────────────────────────────────

export interface MonteCarloResult {
  simulations: number;
  expectedPnlCents: number;            // analytical E[P&L]
  meanPnlCents: number;                // empirical mean across sims
  stdDevPnlCents: number;
  medianPnlCents: number;
  p5PnlCents: number;
  p25PnlCents: number;
  p75PnlCents: number;
  p95PnlCents: number;
  worstPnlCents: number;
  bestPnlCents: number;
  probLoss: number;                    // P(P&L < 0)
  probLoss10Pct: number;               // P(P&L < -10% of allocated capital)
  probLoss20Pct: number;
  probLoss30Pct: number;
  longestLosingStreak: number;         // worst run of negative-PnL signals seen
  histogram: { binCenter: number; count: number }[];
  /** Up to 50 sample cumulative-PnL paths for the visualization. */
  paths: { idx: number; cumulativePnl: number[] }[];
  /** Drawdown stats across all simulated paths (random ordering per iteration). */
  meanMaxDrawdownCents: number;
  medianMaxDrawdownCents: number;
  worstMaxDrawdownCents: number;
}

interface MonteCarloOpts {
  simulations: number;
  capital: number;
  seed?: number;
  pAdjust?: number; // additive adjustment to p (negative = pessimistic)
}

function runMonteCarlo(positions: Position[], opts: MonteCarloOpts): MonteCarloResult {
  const N = Math.max(1, opts.simulations);
  const rand = mulberry32(opts.seed ?? 42);
  const finalPnls: number[] = new Array(N);
  const maxDrawdowns: number[] = new Array(N);
  const sampledPaths: { idx: number; cumulativePnl: number[] }[] = [];
  const SAMPLE_PATHS = Math.min(50, N);
  let longestLosingStreak = 0;

  // Precompute analytical E[P&L]
  const pAdj = opts.pAdjust ?? 0;
  const expectedPnl = positions.reduce((s, pos) => {
    const p = Math.max(0, Math.min(1, pos.p + pAdj));
    return s + (p * pos.payoutIfWin - (1 - p) * pos.stake);
  }, 0);

  for (let i = 0; i < N; i++) {
    // Random order for drawdown calc
    const order = positions.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }

    let cum = 0;
    let runningMax = 0;
    let maxDD = 0;
    let streak = 0;
    let curStreak = 0;
    const path: number[] = [];
    for (const idx of order) {
      const pos = positions[idx];
      const p = Math.max(0, Math.min(1, pos.p + pAdj));
      const won = rand() < p;
      const pnl = won ? pos.payoutIfWin : -pos.stake;
      cum += pnl;
      if (cum > runningMax) runningMax = cum;
      const dd = runningMax - cum;
      if (dd > maxDD) maxDD = dd;
      if (pnl < 0) {
        curStreak++;
        if (curStreak > streak) streak = curStreak;
      } else {
        curStreak = 0;
      }
      path.push(cum);
    }
    finalPnls[i] = cum;
    maxDrawdowns[i] = maxDD;
    if (streak > longestLosingStreak) longestLosingStreak = streak;
    if (i < SAMPLE_PATHS) sampledPaths.push({ idx: i, cumulativePnl: path });
  }

  // Stats
  const sortedPnl = [...finalPnls].sort((a, b) => a - b);
  const sortedDD  = [...maxDrawdowns].sort((a, b) => a - b);
  const pct = (arr: number[], q: number) => arr[Math.floor(q * (arr.length - 1))];

  const mean = finalPnls.reduce((s, v) => s + v, 0) / N;
  const variance = finalPnls.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, N - 1);
  const std = Math.sqrt(variance);
  const cap = Math.max(1, opts.capital);
  const probLoss     = sortedPnl.filter(v => v < 0).length / N;
  const probLoss10   = sortedPnl.filter(v => v < -0.10 * cap).length / N;
  const probLoss20   = sortedPnl.filter(v => v < -0.20 * cap).length / N;
  const probLoss30   = sortedPnl.filter(v => v < -0.30 * cap).length / N;

  // Histogram (20 buckets across observed range)
  const HIST_BUCKETS = 20;
  const minP = sortedPnl[0];
  const maxP = sortedPnl[sortedPnl.length - 1];
  const range = Math.max(1, maxP - minP);
  const counts = new Array(HIST_BUCKETS).fill(0);
  for (const v of finalPnls) {
    const bin = Math.min(HIST_BUCKETS - 1, Math.floor(((v - minP) / range) * HIST_BUCKETS));
    counts[bin]++;
  }
  const histogram = counts.map((c, i) => ({
    binCenter: Math.round(minP + (i + 0.5) * (range / HIST_BUCKETS)),
    count: c,
  }));

  return {
    simulations: N,
    expectedPnlCents: Math.round(expectedPnl),
    meanPnlCents: Math.round(mean),
    stdDevPnlCents: Math.round(std),
    medianPnlCents: Math.round(pct(sortedPnl, 0.50)),
    p5PnlCents:  Math.round(pct(sortedPnl, 0.05)),
    p25PnlCents: Math.round(pct(sortedPnl, 0.25)),
    p75PnlCents: Math.round(pct(sortedPnl, 0.75)),
    p95PnlCents: Math.round(pct(sortedPnl, 0.95)),
    worstPnlCents: Math.round(sortedPnl[0]),
    bestPnlCents: Math.round(sortedPnl[sortedPnl.length - 1]),
    probLoss: Math.round(probLoss * 1000) / 10,
    probLoss10Pct: Math.round(probLoss10 * 1000) / 10,
    probLoss20Pct: Math.round(probLoss20 * 1000) / 10,
    probLoss30Pct: Math.round(probLoss30 * 1000) / 10,
    longestLosingStreak,
    histogram,
    paths: sampledPaths,
    meanMaxDrawdownCents: Math.round(maxDrawdowns.reduce((s, v) => s + v, 0) / N),
    medianMaxDrawdownCents: Math.round(pct(sortedDD, 0.50)),
    worstMaxDrawdownCents: Math.round(sortedDD[sortedDD.length - 1]),
  };
}

// ── Stress scenarios ────────────────────────────────────────────────────────

export type ScenarioName =
  | 'base'
  | 'bad_calibration'
  | 'severe_miscalibration'
  | 'correlated_loss_day'
  | 'city_cluster_failure'
  | 'metric_cluster_failure'
  | 'long_shot_failure';

export interface StressScenarioResult {
  scenario: ScenarioName;
  label: string;
  description: string;
  pnlCents: number;
  drawdownCents: number;
  affectedExposureCents: number;
  warning: 'low' | 'medium' | 'high' | 'critical';
}

function expectedPnlOver(positions: Position[], modify: (pos: Position) => Position): number {
  return positions.reduce((s, pos) => {
    const m = modify(pos);
    return s + (m.p * m.payoutIfWin - (1 - m.p) * m.stake);
  }, 0);
}

function lossesIfBucketFails(positions: Position[], pickBucket: (p: Position) => string | undefined, targetKey: string | undefined): { pnl: number; affected: number } {
  if (!targetKey) return { pnl: 0, affected: 0 };
  let pnl = 0;
  let affected = 0;
  for (const pos of positions) {
    const k = pickBucket(pos);
    if (k === targetKey) {
      pnl -= pos.stake;
      affected += pos.stake;
    } else {
      pnl += pos.expectedPnl;
    }
  }
  return { pnl, affected };
}

function largestBucket(positions: Position[], pickBucket: (p: Position) => string | undefined): { key?: string; cents: number } {
  const map: Record<string, number> = {};
  for (const pos of positions) {
    const k = pickBucket(pos);
    if (!k) continue;
    map[k] = (map[k] ?? 0) + pos.stake;
  }
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? { key: entries[0][0], cents: entries[0][1] } : { cents: 0 };
}

function classifyWarning(lossPct: number): StressScenarioResult['warning'] {
  if (lossPct >= 0.30) return 'critical';
  if (lossPct >= 0.15) return 'high';
  if (lossPct >= 0.05) return 'medium';
  return 'low';
}

function runStressScenarios(positions: Position[], capital: number): StressScenarioResult[] {
  const out: StressScenarioResult[] = [];
  const totalStake = positions.reduce((s, p) => s + p.stake, 0);

  // Base
  const baseEv = expectedPnlOver(positions, p => p);
  out.push({
    scenario: 'base',
    label: 'Base case',
    description: 'Expected P&L using current model probabilities — no shocks.',
    pnlCents: Math.round(baseEv),
    drawdownCents: Math.max(0, Math.round(-baseEv)),
    affectedExposureCents: totalStake,
    warning: classifyWarning(Math.max(0, -baseEv) / Math.max(1, capital)),
  });

  // Bad calibration: p − 0.10
  const bad = expectedPnlOver(positions, p => ({ ...p, p: Math.max(0, p.p - 0.10), expectedPnl: 0 }));
  out.push({
    scenario: 'bad_calibration',
    label: 'Bad calibration (−10%)',
    description: 'Reduce model win probability by 10 pp on every signal.',
    pnlCents: Math.round(bad),
    drawdownCents: Math.max(0, Math.round(-bad)),
    affectedExposureCents: totalStake,
    warning: classifyWarning(Math.max(0, -bad) / Math.max(1, capital)),
  });

  // Severe miscalibration: p − 0.20
  const severe = expectedPnlOver(positions, p => ({ ...p, p: Math.max(0, p.p - 0.20), expectedPnl: 0 }));
  out.push({
    scenario: 'severe_miscalibration',
    label: 'Severe miscalibration (−20%)',
    description: 'Reduce model win probability by 20 pp on every signal.',
    pnlCents: Math.round(severe),
    drawdownCents: Math.max(0, Math.round(-severe)),
    affectedExposureCents: totalStake,
    warning: classifyWarning(Math.max(0, -severe) / Math.max(1, capital)),
  });

  // Correlated loss day
  const biggestDate = largestBucket(positions, p => p.date);
  const dateLoss = lossesIfBucketFails(positions, p => p.date, biggestDate.key);
  out.push({
    scenario: 'correlated_loss_day',
    label: 'Correlated loss day',
    description: biggestDate.key ? `All signals on ${biggestDate.key} lose; everything else hits its expected value.` : 'No date concentration to test.',
    pnlCents: Math.round(dateLoss.pnl),
    drawdownCents: Math.max(0, Math.round(-dateLoss.pnl)),
    affectedExposureCents: dateLoss.affected,
    warning: classifyWarning(Math.max(0, -dateLoss.pnl) / Math.max(1, capital)),
  });

  // City cluster failure
  const biggestCity = largestBucket(positions, p => p.city);
  const cityLoss = lossesIfBucketFails(positions, p => p.city, biggestCity.key);
  out.push({
    scenario: 'city_cluster_failure',
    label: 'City cluster failure',
    description: biggestCity.key ? `All signals in ${biggestCity.key} lose; everything else hits expected value.` : 'No city concentration to test.',
    pnlCents: Math.round(cityLoss.pnl),
    drawdownCents: Math.max(0, Math.round(-cityLoss.pnl)),
    affectedExposureCents: cityLoss.affected,
    warning: classifyWarning(Math.max(0, -cityLoss.pnl) / Math.max(1, capital)),
  });

  // Metric cluster failure
  const biggestMetric = largestBucket(positions, p => p.metric);
  const metricLoss = lossesIfBucketFails(positions, p => p.metric, biggestMetric.key);
  out.push({
    scenario: 'metric_cluster_failure',
    label: 'Metric cluster failure',
    description: biggestMetric.key ? `All "${biggestMetric.key}" signals lose; everything else hits expected value.` : 'No metric concentration to test.',
    pnlCents: Math.round(metricLoss.pnl),
    drawdownCents: Math.max(0, Math.round(-metricLoss.pnl)),
    affectedExposureCents: metricLoss.affected,
    warning: classifyWarning(Math.max(0, -metricLoss.pnl) / Math.max(1, capital)),
  });

  // Long-shot failure: high edge + low reliability all lose
  const longShots = positions.filter(p => (p.calibratedEdge ?? 0) >= 0.05 && (p.reliabilityFactor ?? 1) < 0.6);
  let longShotPnl = 0;
  let longShotAffected = 0;
  for (const pos of positions) {
    if (longShots.includes(pos)) {
      longShotPnl -= pos.stake;
      longShotAffected += pos.stake;
    } else {
      longShotPnl += pos.expectedPnl;
    }
  }
  out.push({
    scenario: 'long_shot_failure',
    label: 'Long-shot failure',
    description: `${longShots.length} signal(s) with calibratedEdge ≥ 5% and reliabilityFactor < 60% all lose.`,
    pnlCents: Math.round(longShotPnl),
    drawdownCents: Math.max(0, Math.round(-longShotPnl)),
    affectedExposureCents: longShotAffected,
    warning: classifyWarning(Math.max(0, -longShotPnl) / Math.max(1, capital)),
  });

  return out;
}

// ── Concentration heatmap ───────────────────────────────────────────────────

export interface ConcentrationCell {
  bucket: string;
  cents: number;
  pctOfPortfolio: number;
}

function concentration(positions: Position[], pick: (p: Position) => string | undefined): ConcentrationCell[] {
  const total = positions.reduce((s, p) => s + p.stake, 0);
  const map: Record<string, number> = {};
  for (const pos of positions) {
    const k = pick(pos);
    if (!k) continue;
    map[k] = (map[k] ?? 0) + pos.stake;
  }
  return Object.entries(map)
    .map(([bucket, cents]) => ({ bucket, cents, pctOfPortfolio: total > 0 ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

// ── Risk verdict ────────────────────────────────────────────────────────────

export type RiskVerdict = 'Healthy' | 'Watch' | 'Risky' | 'Unsafe';

interface VerdictInput {
  totalAllocatedCents: number;
  capital: number;
  mc: MonteCarloResult;
  stresses: StressScenarioResult[];
  concentrationByCity: ConcentrationCell[];
  concentrationByDate: ConcentrationCell[];
  concentrationByMetric: ConcentrationCell[];
  signalCount: number;
}

function classifyVerdict(input: VerdictInput): { verdict: RiskVerdict; reason: string } {
  const reasons: string[] = [];
  let verdict: RiskVerdict = 'Healthy';

  const cap = Math.max(1, input.capital);
  const ddPct = input.mc.worstMaxDrawdownCents / cap;
  const probLoss = input.mc.probLoss / 100;
  const probLoss20 = input.mc.probLoss20Pct / 100;
  const stressMaxLossPct = Math.max(0, ...input.stresses.map(s => -s.pnlCents / cap));
  const concentrationMaxPct = Math.max(
    0,
    ...input.concentrationByCity.slice(0, 1).map(b => b.pctOfPortfolio),
    ...input.concentrationByDate.slice(0, 1).map(b => b.pctOfPortfolio),
    ...input.concentrationByMetric.slice(0, 1).map(b => b.pctOfPortfolio),
  );

  if (input.signalCount === 0) return { verdict: 'Healthy', reason: 'No signals allocated — nothing at risk.' };
  if (input.signalCount < 5) reasons.push(`only ${input.signalCount} signal(s) sampled — verdict has high uncertainty`);

  // Climbing severity
  if (ddPct > 0.10 || probLoss > 0.30 || concentrationMaxPct > 0.40 || probLoss20 > 0.10 || stressMaxLossPct > 0.10) verdict = 'Watch';
  if (ddPct > 0.20 || probLoss > 0.50 || concentrationMaxPct > 0.60 || probLoss20 > 0.20 || stressMaxLossPct > 0.20) verdict = 'Risky';
  if (ddPct > 0.40 || probLoss > 0.70 || concentrationMaxPct > 0.80 || probLoss20 > 0.40 || stressMaxLossPct > 0.40) verdict = 'Unsafe';

  if (ddPct > 0.10) reasons.push(`worst-case drawdown ${(ddPct * 100).toFixed(0)}% of allocated capital`);
  if (probLoss20 > 0.10) reasons.push(`${(probLoss20 * 100).toFixed(0)}% probability of losing >20%`);
  if (concentrationMaxPct > 0.40) reasons.push(`top concentration is ${(concentrationMaxPct * 100).toFixed(0)}% in one bucket`);
  if (stressMaxLossPct > 0.10) reasons.push(`worst stress scenario loses ${(stressMaxLossPct * 100).toFixed(0)}% of capital`);

  return {
    verdict,
    reason: reasons.length > 0 ? reasons.join('; ') : 'All metrics within healthy ranges.',
  };
}

// ── Top-level report ────────────────────────────────────────────────────────

export interface StressTestReport {
  generatedAt: string;
  config: { simulations: number; bankrollCents: number };
  allocationSummary: {
    signals: number;
    totalAllocatedCents: number;
    bankrollCents: number;
  };
  monteCarlo: MonteCarloResult;
  stressScenarios: StressScenarioResult[];
  concentration: {
    byCity: ConcentrationCell[];
    byDate: ConcentrationCell[];
    byMetric: ConcentrationCell[];
  };
  verdict: { verdict: RiskVerdict; reason: string };
  notes: string[];
}

export interface BuildStressTestOpts {
  simulations?: number;
  seed?: number;
}

export async function buildStressTestReport(opts: BuildStressTestOpts = {}): Promise<StressTestReport> {
  const allocation = await buildAllocationReport();
  const records = allocation.records.filter(r => r.cappedStakeCents > 0);
  const positions = records.map(asPosition);
  const totalAllocated = positions.reduce((s, p) => s + p.stake, 0);

  const simulations = Math.max(50, Math.min(opts.simulations ?? 1000, 10_000));
  const capital = allocation.config.BANKROLL_CENTS;

  const mc = positions.length > 0
    ? runMonteCarlo(positions, { simulations, capital, seed: opts.seed })
    : emptyMc(simulations);
  const stresses = positions.length > 0
    ? runStressScenarios(positions, capital)
    : [];
  const byCity   = concentration(positions, p => p.city);
  const byDate   = concentration(positions, p => p.date);
  const byMetric = concentration(positions, p => p.metric);

  const verdict = classifyVerdict({
    totalAllocatedCents: totalAllocated,
    capital,
    mc,
    stresses,
    concentrationByCity: byCity,
    concentrationByDate: byDate,
    concentrationByMetric: byMetric,
    signalCount: positions.length,
  });

  return {
    generatedAt: new Date().toISOString(),
    config: { simulations, bankrollCents: capital },
    allocationSummary: { signals: positions.length, totalAllocatedCents: totalAllocated, bankrollCents: capital },
    monteCarlo: mc,
    stressScenarios: stresses,
    concentration: { byCity, byDate, byMetric },
    verdict,
    notes: [
      `Monte Carlo: ${simulations} simulations using model probability per signal. Each signal resolves independently — correlations are tested separately via stress scenarios.`,
      'Per-signal payout: stake × (1 − marketProb) / marketProb if marketProb is known; defaults to even-money (50¢) when not.',
      'Drawdown is computed over a randomized resolution order per simulation; reported metrics aggregate across paths.',
      'Stress scenarios are deterministic point estimates — not Monte Carlo. They isolate single-failure modes.',
      'Risk verdicts use thresholds on max drawdown %, probability of loss, probability of >20% loss, top bucket concentration, and worst stress-scenario loss. Cumulative — the worst category sets the verdict.',
      'Sample-size caveat: with fewer than ~30 allocated signals, simulation outputs have wide uncertainty bands. Treat verdicts as directional, not authoritative.',
      'No autonomous trading. No order submission. No candidate auto-creation. Read-only simulation.',
    ],
  };
}

function emptyMc(simulations: number): MonteCarloResult {
  return {
    simulations,
    expectedPnlCents: 0, meanPnlCents: 0, stdDevPnlCents: 0,
    medianPnlCents: 0, p5PnlCents: 0, p25PnlCents: 0, p75PnlCents: 0, p95PnlCents: 0,
    worstPnlCents: 0, bestPnlCents: 0,
    probLoss: 0, probLoss10Pct: 0, probLoss20Pct: 0, probLoss30Pct: 0,
    longestLosingStreak: 0, histogram: [], paths: [],
    meanMaxDrawdownCents: 0, medianMaxDrawdownCents: 0, worstMaxDrawdownCents: 0,
  };
}
