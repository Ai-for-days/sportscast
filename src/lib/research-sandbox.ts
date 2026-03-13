import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getModelTag } from './model-registry';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type ScenarioType =
  | 'pricing'
  | 'signal_filtering'
  | 'sizing'
  | 'volatility_shock'
  | 'portfolio_constraint';

export const SCENARIO_TYPES: { type: ScenarioType; label: string; description: string }[] = [
  { type: 'pricing', label: 'Pricing Scenario', description: 'Adjust vig/hold, shift mean/std dev, compare O/U and range odds' },
  { type: 'signal_filtering', label: 'Signal Filtering', description: 'Change edge/confidence/score thresholds, compare signals kept vs dropped' },
  { type: 'sizing', label: 'Sizing Scenario', description: 'Change tier thresholds and max stake, compare recommended stakes' },
  { type: 'volatility_shock', label: 'Volatility Shock', description: 'Widen or shrink std dev, compare probabilities and risk' },
  { type: 'portfolio_constraint', label: 'Portfolio Constraint', description: 'Change exposure caps, compare constrained vs unconstrained recommendations' },
];

export interface ScenarioInputs {
  // Pricing
  vigAdjustment?: number;         // e.g. +0.02 adds 2% vig
  holdAdjustment?: number;        // e.g. +0.01 adds 1% hold
  meanShift?: number;             // shift forecast mean
  stdDevShift?: number;           // shift forecast std dev

  // Signal filtering
  edgeThreshold?: number;         // minimum edge to keep signal
  confidenceThreshold?: number;   // minimum confidence to keep signal
  scoreThreshold?: number;        // minimum score to keep signal

  // Sizing
  tierThresholds?: { small: number; medium: number; large: number };
  maxStakeCents?: number;

  // Volatility shock
  volatilityMultiplier?: number;  // e.g. 1.5 = 50% wider

  // Portfolio constraint
  maxExposureCents?: number;
  maxConcentrationPct?: number;

  // Filters
  sourceFilter?: string;
  confidenceFilter?: string;
  modeFilter?: string;

  // Model governance
  modelFamily?: string;
  modelVersionId?: string;
}

export interface ScenarioMetrics {
  signalCount: number;
  avgEdge: number;
  avgScore: number;
  avgConfidence: number;
  totalExposureCents: number;
  largeTradeCount: number;
  mediumTradeCount: number;
  smallTradeCount: number;
  avgProbability: number;
  avgModelLine: number;
  concentrationUtilization: number;
}

export interface ScenarioResult {
  baseline: ScenarioMetrics;
  scenario: ScenarioMetrics;
  delta: ScenarioMetrics;
  details: ScenarioDetailRow[];
}

export interface ScenarioDetailRow {
  label: string;
  baselineValue: number | string;
  scenarioValue: number | string;
  delta: number | string;
  impact: 'positive' | 'negative' | 'neutral';
}

export interface SandboxRun {
  id: string;
  createdAt: string;
  name: string;
  description?: string;
  scenarioType: ScenarioType;
  inputs: ScenarioInputs;
  results: ScenarioResult;
  modelTags?: Record<string, string>;
  experimentId?: string;
  createdBy: 'admin';
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                          */
/* ------------------------------------------------------------------ */

const SANDBOX_PREFIX = 'sandbox:run:';
const SANDBOX_SET = 'sandbox:runs:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function saveSandboxRun(run: SandboxRun): Promise<void> {
  const redis = getRedis();
  await redis.set(`${SANDBOX_PREFIX}${run.id}`, JSON.stringify(run));
  await redis.zadd(SANDBOX_SET, { score: Date.now(), member: run.id });
}

export async function getSandboxRun(id: string): Promise<SandboxRun | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SANDBOX_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as SandboxRun;
}

export async function listSandboxRuns(): Promise<SandboxRun[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SANDBOX_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const runs: SandboxRun[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SANDBOX_PREFIX}${id}`);
    if (raw) {
      runs.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as SandboxRun);
    }
  }
  return runs;
}

/* ------------------------------------------------------------------ */
/*  Scenario Engine                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build baseline metrics from current system signals/candidates.
 * Uses in-memory simulation — no production writes.
 */
async function fetchBaselineData(): Promise<{
  signals: any[];
  candidates: any[];
  positions: any[];
}> {
  const redis = getRedis();

  // Fetch recent signals
  const signalIds = await redis.zrange('kalshi-signals:all', 0, -1, { rev: true }) || [];
  const signals: any[] = [];
  for (const id of signalIds.slice(0, 200)) {
    const raw = await redis.get(`kalshi-signal:${id}`);
    if (raw) signals.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }

  // Fetch execution candidates
  const candIds = await redis.zrange('exec-candidates:all', 0, -1, { rev: true }) || [];
  const candidates: any[] = [];
  for (const id of candIds.slice(0, 200)) {
    const raw = await redis.get(`exec-candidate:${id}`);
    if (raw) candidates.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }

  // Fetch positions
  const posIds = await redis.zrange('positions:all', 0, -1, { rev: true }) || [];
  const positions: any[] = [];
  for (const id of posIds.slice(0, 100)) {
    const raw = await redis.get(`position:${id}`);
    if (raw) positions.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }

  return { signals, candidates, positions };
}

function computeMetrics(
  signals: any[],
  candidates: any[],
  positions: any[],
): ScenarioMetrics {
  const edges = signals.map(s => s.edge ?? s.edgePct ?? 0);
  const scores = signals.map(s => s.score ?? s.compositeScore ?? 0);
  const confidences = signals.map(s => {
    if (typeof s.confidence === 'number') return s.confidence;
    if (s.confidence === 'high') return 0.8;
    if (s.confidence === 'medium') return 0.5;
    return 0.3;
  });
  const probs = signals.map(s => s.modelProbability ?? s.probability ?? 0.5);
  const lines = signals.map(s => s.modelLine ?? s.line ?? 0);

  const stakes = candidates.map(c => c.recommendedStakeCents ?? c.stakeCents ?? 0);
  const totalExposure = stakes.reduce((a: number, b: number) => a + b, 0);

  const large = candidates.filter(c => (c.sizingTier || c.tier) === 'large').length;
  const medium = candidates.filter(c => (c.sizingTier || c.tier) === 'medium').length;
  const small = candidates.filter(c => (c.sizingTier || c.tier) === 'small' || !(c.sizingTier || c.tier)).length;

  const posExposure = positions.reduce((a: number, p: number | any) => a + Math.abs(p.exposureCents ?? p.totalCostCents ?? 0), 0);
  const maxExposure = 500000; // default $5000 cap
  const concUtil = maxExposure > 0 ? posExposure / maxExposure : 0;

  return {
    signalCount: signals.length,
    avgEdge: edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : 0,
    avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    avgConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
    totalExposureCents: totalExposure,
    largeTradeCount: large,
    mediumTradeCount: medium,
    smallTradeCount: small,
    avgProbability: probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0,
    avgModelLine: lines.length ? lines.reduce((a, b) => a + b, 0) / lines.length : 0,
    concentrationUtilization: concUtil,
  };
}

function applyScenario(
  signals: any[],
  candidates: any[],
  positions: any[],
  inputs: ScenarioInputs,
  scenarioType: ScenarioType,
): { signals: any[]; candidates: any[]; positions: any[] } {
  // Deep copy to avoid mutating originals
  let sigs = signals.map(s => ({ ...s }));
  let cands = candidates.map(c => ({ ...c }));
  let pos = positions.map(p => ({ ...p }));

  switch (scenarioType) {
    case 'pricing': {
      // Shift mean and std dev on signals, adjust vig
      const meanShift = inputs.meanShift ?? 0;
      const stdShift = inputs.stdDevShift ?? 0;
      const vigAdj = inputs.vigAdjustment ?? 0;

      sigs = sigs.map(s => {
        const prob = (s.modelProbability ?? s.probability ?? 0.5) + meanShift;
        const clamped = Math.max(0.01, Math.min(0.99, prob));
        return {
          ...s,
          modelProbability: clamped,
          probability: clamped,
          edge: (s.edge ?? s.edgePct ?? 0) + meanShift - vigAdj,
        };
      });
      break;
    }

    case 'signal_filtering': {
      const edgeTh = inputs.edgeThreshold ?? -Infinity;
      const confTh = inputs.confidenceThreshold ?? -Infinity;
      const scoreTh = inputs.scoreThreshold ?? -Infinity;

      sigs = sigs.filter(s => {
        const edge = s.edge ?? s.edgePct ?? 0;
        const score = s.score ?? s.compositeScore ?? 0;
        let conf = 0;
        if (typeof s.confidence === 'number') conf = s.confidence;
        else if (s.confidence === 'high') conf = 0.8;
        else if (s.confidence === 'medium') conf = 0.5;
        else conf = 0.3;
        return edge >= edgeTh && conf >= confTh && score >= scoreTh;
      });

      // Filter candidates to match remaining signals
      const sigTickers = new Set(sigs.map(s => s.ticker));
      cands = cands.filter(c => sigTickers.has(c.ticker));
      break;
    }

    case 'sizing': {
      const maxStake = inputs.maxStakeCents ?? 5000;
      const tiers = inputs.tierThresholds ?? { small: 0.03, medium: 0.06, large: 0.10 };

      cands = cands.map(c => {
        const edge = c.edge ?? c.edgePct ?? 0;
        let tier = 'small';
        let stake = Math.min(maxStake * 0.25, maxStake);
        if (edge >= tiers.large) { tier = 'large'; stake = maxStake; }
        else if (edge >= tiers.medium) { tier = 'medium'; stake = Math.round(maxStake * 0.6); }
        else if (edge >= tiers.small) { tier = 'small'; stake = Math.round(maxStake * 0.25); }
        else { tier = 'skip'; stake = 0; }
        return { ...c, sizingTier: tier, tier, recommendedStakeCents: stake, stakeCents: stake };
      }).filter(c => c.sizingTier !== 'skip');
      break;
    }

    case 'volatility_shock': {
      const mult = inputs.volatilityMultiplier ?? 1.0;
      sigs = sigs.map(s => {
        const prob = s.modelProbability ?? s.probability ?? 0.5;
        // Wider vol pushes probabilities toward 0.5
        const shifted = 0.5 + (prob - 0.5) / mult;
        const clamped = Math.max(0.01, Math.min(0.99, shifted));
        const edge = (s.edge ?? s.edgePct ?? 0) / mult;
        return { ...s, modelProbability: clamped, probability: clamped, edge, edgePct: edge };
      });
      break;
    }

    case 'portfolio_constraint': {
      const maxExp = inputs.maxExposureCents ?? 500000;
      const maxConc = inputs.maxConcentrationPct ?? 20;
      let running = 0;
      const tickerExposure: Record<string, number> = {};

      cands = cands.filter(c => {
        const stake = c.recommendedStakeCents ?? c.stakeCents ?? 0;
        const ticker = c.ticker || 'unknown';
        const tickerExp = tickerExposure[ticker] || 0;
        const tickerLimit = maxExp * (maxConc / 100);

        if (running + stake > maxExp) return false;
        if (tickerExp + stake > tickerLimit) return false;

        running += stake;
        tickerExposure[ticker] = tickerExp + stake;
        return true;
      });
      break;
    }
  }

  // Apply source/confidence/mode filters
  if (inputs.sourceFilter) {
    sigs = sigs.filter(s => (s.source || '') === inputs.sourceFilter);
    const sigTickers = new Set(sigs.map(s => s.ticker));
    cands = cands.filter(c => sigTickers.has(c.ticker));
  }
  if (inputs.confidenceFilter) {
    sigs = sigs.filter(s => (s.confidence || '') === inputs.confidenceFilter);
    const sigTickers = new Set(sigs.map(s => s.ticker));
    cands = cands.filter(c => sigTickers.has(c.ticker));
  }

  return { signals: sigs, candidates: cands, positions: pos };
}

function computeDelta(baseline: ScenarioMetrics, scenario: ScenarioMetrics): ScenarioMetrics {
  return {
    signalCount: scenario.signalCount - baseline.signalCount,
    avgEdge: scenario.avgEdge - baseline.avgEdge,
    avgScore: scenario.avgScore - baseline.avgScore,
    avgConfidence: scenario.avgConfidence - baseline.avgConfidence,
    totalExposureCents: scenario.totalExposureCents - baseline.totalExposureCents,
    largeTradeCount: scenario.largeTradeCount - baseline.largeTradeCount,
    mediumTradeCount: scenario.mediumTradeCount - baseline.mediumTradeCount,
    smallTradeCount: scenario.smallTradeCount - baseline.smallTradeCount,
    avgProbability: scenario.avgProbability - baseline.avgProbability,
    avgModelLine: scenario.avgModelLine - baseline.avgModelLine,
    concentrationUtilization: scenario.concentrationUtilization - baseline.concentrationUtilization,
  };
}

function buildDetailRows(baseline: ScenarioMetrics, scenario: ScenarioMetrics): ScenarioDetailRow[] {
  const rows: ScenarioDetailRow[] = [];
  const fields: { key: keyof ScenarioMetrics; label: string; fmt?: (v: number) => string; higherBetter?: boolean }[] = [
    { key: 'signalCount', label: 'Signals' },
    { key: 'avgEdge', label: 'Avg Edge', fmt: v => (v * 100).toFixed(2) + '%', higherBetter: true },
    { key: 'avgScore', label: 'Avg Score', fmt: v => v.toFixed(2), higherBetter: true },
    { key: 'avgConfidence', label: 'Avg Confidence', fmt: v => (v * 100).toFixed(1) + '%', higherBetter: true },
    { key: 'totalExposureCents', label: 'Total Exposure', fmt: v => '$' + (v / 100).toFixed(2) },
    { key: 'largeTradeCount', label: 'Large Trades' },
    { key: 'mediumTradeCount', label: 'Medium Trades' },
    { key: 'smallTradeCount', label: 'Small Trades' },
    { key: 'avgProbability', label: 'Avg Probability', fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'avgModelLine', label: 'Avg Model Line', fmt: v => v.toFixed(2) },
    { key: 'concentrationUtilization', label: 'Concentration Util', fmt: v => (v * 100).toFixed(1) + '%' },
  ];

  for (const f of fields) {
    const bv = baseline[f.key] as number;
    const sv = scenario[f.key] as number;
    const d = sv - bv;
    const format = f.fmt || ((v: number) => String(v));
    let impact: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (d !== 0) {
      if (f.higherBetter !== undefined) impact = (d > 0) === f.higherBetter ? 'positive' : 'negative';
    }
    rows.push({
      label: f.label,
      baselineValue: format(bv),
      scenarioValue: format(sv),
      delta: (d >= 0 ? '+' : '') + format(d),
      impact,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Run scenario                                                        */
/* ------------------------------------------------------------------ */

export async function runScenario(
  scenarioType: ScenarioType,
  inputs: ScenarioInputs,
): Promise<ScenarioResult> {
  const { signals, candidates, positions } = await fetchBaselineData();

  const baselineMetrics = computeMetrics(signals, candidates, positions);

  const modified = applyScenario(signals, candidates, positions, inputs, scenarioType);
  const scenarioMetrics = computeMetrics(modified.signals, modified.candidates, modified.positions);

  const delta = computeDelta(baselineMetrics, scenarioMetrics);
  const details = buildDetailRows(baselineMetrics, scenarioMetrics);

  return { baseline: baselineMetrics, scenario: scenarioMetrics, delta, details };
}

/* ------------------------------------------------------------------ */
/*  Save run                                                            */
/* ------------------------------------------------------------------ */

export async function saveScenarioRun(
  name: string,
  scenarioType: ScenarioType,
  inputs: ScenarioInputs,
  results: ScenarioResult,
  description?: string,
  experimentId?: string,
): Promise<SandboxRun> {
  // Gather active model tags
  const modelTags: Record<string, string> = {};
  const families = ['forecast_verification_v2', 'bookmaker_pricing', 'signal_ranking', 'portfolio_sizing'];
  for (const f of families) {
    try { modelTags[f] = await getModelTag(f); } catch { /* ignore */ }
  }

  const run: SandboxRun = {
    id: `sbx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    name,
    description,
    scenarioType,
    inputs,
    results,
    modelTags,
    experimentId,
    createdBy: 'admin',
  };

  await saveSandboxRun(run);

  await logAuditEvent({
    actor: 'admin',
    eventType: 'sandbox_run_saved',
    targetType: 'sandbox-run',
    targetId: run.id,
    summary: `Sandbox run saved: ${name} (${scenarioType})`,
  });

  return run;
}

/* ------------------------------------------------------------------ */
/*  Export helpers                                                       */
/* ------------------------------------------------------------------ */

export function resultToCSV(result: ScenarioResult): string {
  const header = 'Metric,Baseline,Scenario,Delta,Impact';
  const rows = result.details.map(d =>
    `"${d.label}","${d.baselineValue}","${d.scenarioValue}","${d.delta}","${d.impact}"`
  );
  return [header, ...rows].join('\n');
}
