// ── Step 76: Edge Validation — decision-grade quant layer ───────────────────
//
// Compares expected calibrated edge (from Step 70) against realized edge from
// settled trades, and tests statistical significance. Read-only analytics —
// no impact on ranking, sizing, execution, or risk.
//
// Definitions:
//   EV  = Expected Value     = average pre-trade calibratedEdge across the segment
//   RV  = Realized Value     = realized hit rate − 0.5 (excess over coin-flip baseline,
//                              which puts RV in the same units as EV)
//   gap = Edge Gap           = RV − EV  (positive = realized > expected)
//   SE  = Standard Error     = sqrt(p(1−p)/n) on the hit rate
//   95% CI on hit rate       = p ± 1.96 × SE   (mapped to edge: (p ± 1.96 SE) − 0.5)
//   Z   = (RV − EV) / SE
//   p   = two-tailed normal p-value via Abramowitz–Stegun approximation
//
// Verdicts (require n ≥ MIN_SAMPLE):
//   "Validated Edge"  : RV > EV AND Z >  1.96
//   "Overestimated"   : RV < EV AND Z < −1.96
//   "Neutral"         : |Z| ≤ 1.96
//   "Insufficient sample" : n < MIN_SAMPLE

import { getRedis } from './redis';
import { EDGE_BUCKETS, HORIZON_BUCKETS, evidenceLabel } from './calibration-lab';

const MIN_SAMPLE = 30;
const Z_95 = 1.96;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Stat helpers ────────────────────────────────────────────────────────────

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 approximation (max abs error ≈ 7.5e-8). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z >= 0) p = 1 - p;
  return p;
}

export function twoTailedPValue(z: number): number {
  return Math.max(0, Math.min(1, 2 * (1 - normCdf(Math.abs(z)))));
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface EdgeValidationFilters {
  dateFrom?: string;
  dateTo?: string;
  source?: 'kalshi' | 'sportsbook';
  metric?: string;
  location?: string;
  mode?: 'all' | 'demo' | 'live';
}

// ── Trade record ────────────────────────────────────────────────────────────

interface SettledTrade {
  orderId: string;
  orderSource: 'demo' | 'live';
  ticker?: string;
  side?: 'yes' | 'no';
  signalSource?: 'kalshi' | 'sportsbook';
  confidence?: 'low' | 'medium' | 'high';
  sizingTier?: string;
  expectedEdge?: number;        // candidate.edge (calibrated edge if Step 71+)
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
  outcomeYes?: 0 | 1;
  /** True if pnlCents > 0; null if pnlCents is missing. Pushes (pnl == 0) excluded from win rate. */
  won?: boolean;
  /** Stake at order time when known; used for ROI. */
  costBasisCents?: number;
}

async function loadTrades(filters: EdgeValidationFilters): Promise<SettledTrade[]> {
  const redis = getRedis();
  const { mode = 'all' } = filters;

  const sources: ('demo' | 'live')[] = mode === 'demo' ? ['demo'] : mode === 'live' ? ['live'] : ['demo', 'live'];

  // Orders
  const orders: { os: 'demo' | 'live'; o: any }[] = [];
  for (const s of sources) {
    const setKey = `kalshi:${s}:orders`;
    const keyPrefix = `kalshi:${s}:order:`;
    const total = await redis.zcard(setKey);
    if (total === 0) continue;
    const ids = await redis.zrange(setKey, 0, Math.min(total, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`${keyPrefix}${id}`);
      if (raw) orders.push({ os: s, o: typeof raw === 'string' ? JSON.parse(raw) : raw });
    }
  }

  // Candidates
  const candCount = await redis.zcard('exec:candidates:all');
  const candIds = candCount > 0 ? await redis.zrange('exec:candidates:all', 0, Math.min(candCount, 1000) - 1, { rev: true }) : [];
  const candidates: Record<string, any> = {};
  for (const id of candIds) {
    const raw = await redis.get(`exec:candidate:${id}`);
    if (raw) {
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      candidates[c.id] = c;
    }
  }

  // Settlements
  const settCount = await redis.zcard('settlements:all');
  const settIds = settCount > 0 ? await redis.zrange('settlements:all', 0, Math.min(settCount, 1000) - 1, { rev: true }) : [];
  const settBy = new Map<string, any>();
  for (const id of settIds) {
    const raw = await redis.get(`settlement:${id}`);
    if (raw) {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (s.orderId) settBy.set(s.orderId, s);
    }
  }

  const dateFromMs = filters.dateFrom ? new Date(filters.dateFrom).getTime() : undefined;
  const dateToMs   = filters.dateTo   ? new Date(filters.dateTo).getTime() + DAY_MS - 1 : undefined;

  const out: SettledTrade[] = [];
  for (const { os, o } of orders) {
    const cand = o.candidateId ? candidates[o.candidateId] : undefined;
    const sett = settBy.get(o.id);
    const ts = (o.timestamp ?? o.createdAt) as number | undefined;
    if (dateFromMs != null && (ts == null || ts < dateFromMs)) continue;
    if (dateToMs   != null && (ts == null || ts > dateToMs))   continue;
    if (filters.source   && cand?.source !== filters.source) continue;
    if (filters.metric   && cand?.metric !== filters.metric) continue;
    if (filters.location && !(cand?.locationName ?? '').toLowerCase().includes(filters.location.toLowerCase())) continue;

    const side = o.side as 'yes' | 'no' | undefined;
    const modelProbYes = cand?.marketSnapshot?.modelProbYes;
    const modelProbNo  = cand?.marketSnapshot?.modelProbNo;
    const marketProbYes = cand?.marketSnapshot?.marketProbYes;
    const marketProbNo  = cand?.marketSnapshot?.marketProbNo;
    const modelProbForSide  = side === 'yes' ? modelProbYes  : side === 'no' ? modelProbNo  : undefined;
    const marketProbForSide = side === 'yes' ? marketProbYes : side === 'no' ? marketProbNo : undefined;

    const pnlCents: number | undefined = sett?.netPnlCents;
    let outcomeYes: 0 | 1 | undefined;
    if (pnlCents != null && pnlCents !== 0 && side) {
      outcomeYes = ((side === 'yes') === (pnlCents > 0)) ? 1 : 0;
    }
    const won = pnlCents != null ? pnlCents > 0 : undefined;

    const costBasisCents: number | undefined = (o as any).costBasisCents
      ?? (o as any).maxNotionalCents
      ?? (o as any).stakeCents
      ?? sett?.costBasisCents;

    const leadTimeHours = (() => {
      if (!cand?.targetDate || !ts) return undefined;
      const t = new Date(`${cand.targetDate}T12:00:00Z`).getTime();
      if (Number.isNaN(t)) return undefined;
      return Math.max(0, (t - ts) / 3_600_000);
    })();

    out.push({
      orderId: o.id,
      orderSource: os,
      ticker: o.ticker,
      side,
      signalSource: cand?.source as any,
      confidence: cand?.confidence,
      sizingTier: cand?.sizingTier,
      expectedEdge: cand?.edge,
      rawEdge: cand?.edge,
      calibratedEdge: undefined, // recomputed if needed below
      reliabilityFactor: undefined,
      modelProbForSide,
      marketProbForSide,
      locationName: cand?.locationName,
      metric: cand?.metric,
      forecastSource: cand?.forecastSource ?? cand?.source,
      leadTimeHours,
      timestamp: ts,
      pnlCents,
      outcomeYes,
      won,
      costBasisCents,
    });
  }
  return out;
}

// ── Core stats over a set of trades ─────────────────────────────────────────

export interface SegmentStats {
  segment: string;
  total: number;
  withPnl: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number | null;       // p = wins / withPnl
  expectedEdge: number | null;  // EV = avg calibratedEdge (or rawEdge if unavailable)
  realizedEdge: number | null;  // RV = hitRate − 0.5
  edgeGap: number | null;       // RV − EV
  standardError: number | null; // SE on hit rate
  ci95Low: number | null;       // hit-rate CI low
  ci95High: number | null;
  zScore: number | null;
  pValue: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
  pnlStdDev: number | null;
  sharpeLike: number | null;
  verdict: 'Validated Edge' | 'Overestimated' | 'Neutral' | 'Insufficient sample';
}

function statsOver(label: string, trades: SettledTrade[]): SegmentStats {
  const withPnl = trades.filter(t => t.pnlCents != null);
  const wins = withPnl.filter(t => (t.pnlCents as number) > 0).length;
  const losses = withPnl.filter(t => (t.pnlCents as number) < 0).length;
  const pushes = withPnl.filter(t => (t.pnlCents as number) === 0).length;
  const decisive = wins + losses; // exclude pushes from win-rate
  const hitRate = decisive > 0 ? wins / decisive : null;

  // Expected edge — prefer pre-trade calibratedEdge; fall back to rawEdge.
  const withEdge = trades.filter(t => (t.calibratedEdge ?? t.expectedEdge) != null);
  const ev = withEdge.length > 0
    ? withEdge.reduce((s, t) => s + Math.abs((t.calibratedEdge ?? t.expectedEdge) as number), 0) / withEdge.length
    : null;
  const rv = hitRate != null ? hitRate - 0.5 : null;
  const gap = (rv != null && ev != null) ? rv - ev : null;

  const se = (hitRate != null && decisive > 0) ? Math.sqrt(hitRate * (1 - hitRate) / decisive) : null;
  const ci95Low  = (hitRate != null && se != null) ? hitRate - Z_95 * se : null;
  const ci95High = (hitRate != null && se != null) ? hitRate + Z_95 * se : null;
  const z = (gap != null && se != null && se > 0) ? gap / se : null;
  const p = z != null ? twoTailedPValue(z) : null;

  const totalPnl = withPnl.reduce((s, t) => s + (t.pnlCents as number), 0);
  const avgPnl = withPnl.length > 0 ? totalPnl / withPnl.length : null;
  const pnlStd = (() => {
    if (withPnl.length < 2 || avgPnl == null) return null;
    const variance = withPnl.reduce((s, t) => s + ((t.pnlCents as number) - avgPnl) ** 2, 0) / (withPnl.length - 1);
    return Math.sqrt(variance);
  })();
  const sharpe = (avgPnl != null && pnlStd != null && pnlStd > 0) ? avgPnl / pnlStd : null;

  let verdict: SegmentStats['verdict'];
  if (decisive < MIN_SAMPLE) verdict = 'Insufficient sample';
  else if (z == null || gap == null) verdict = 'Neutral';
  else if (gap > 0 && z > Z_95) verdict = 'Validated Edge';
  else if (gap < 0 && z < -Z_95) verdict = 'Overestimated';
  else verdict = 'Neutral';

  return {
    segment: label,
    total: trades.length,
    withPnl: withPnl.length,
    wins, losses, pushes,
    hitRate: hitRate != null ? Math.round(hitRate * 1000) / 1000 : null,
    expectedEdge: ev != null ? Math.round(ev * 10000) / 10000 : null,
    realizedEdge: rv != null ? Math.round(rv * 10000) / 10000 : null,
    edgeGap: gap != null ? Math.round(gap * 10000) / 10000 : null,
    standardError: se != null ? Math.round(se * 10000) / 10000 : null,
    ci95Low:  ci95Low  != null ? Math.round(ci95Low  * 1000) / 1000 : null,
    ci95High: ci95High != null ? Math.round(ci95High * 1000) / 1000 : null,
    zScore: z != null ? Math.round(z * 1000) / 1000 : null,
    pValue: p != null ? Math.round(p * 10000) / 10000 : null,
    totalPnlCents: totalPnl,
    avgPnlCents: avgPnl != null ? Math.round(avgPnl) : null,
    pnlStdDev: pnlStd != null ? Math.round(pnlStd * 10) / 10 : null,
    sharpeLike: sharpe != null ? Math.round(sharpe * 100) / 100 : null,
    verdict,
  };
}

// ── Recompute calibratedEdge per record using current calibration history ────
// (Best-effort: when calibration history is empty, calibratedEdge falls back
// to rawEdge so EV is still meaningful.)

import { loadCalibrationContext, calibrateSignal } from './signal-calibration';

async function attachCalibration(trades: SettledTrade[]): Promise<void> {
  let ctx;
  try { ctx = await loadCalibrationContext(); } catch { ctx = null; }
  if (!ctx) return;
  for (const t of trades) {
    if (t.expectedEdge == null) continue;
    const cal = calibrateSignal({
      rawEdge: Math.abs(t.expectedEdge),
      modelProbForSide: t.modelProbForSide,
      side: t.side,
      leadTimeHours: t.leadTimeHours,
    }, ctx);
    t.calibratedEdge = cal.calibratedEdge;
    t.reliabilityFactor = cal.reliabilityFactor;
  }
}

// ── Top-level report ────────────────────────────────────────────────────────

export interface EdgeValidationReport {
  generatedAt: string;
  filters: EdgeValidationFilters;
  overall: SegmentStats;
  bySource: SegmentStats[];
  byConfidence: SegmentStats[];
  byTier: SegmentStats[];
  byEdgeBucket: SegmentStats[];
  byHorizon: SegmentStats[];
  /** Cumulative P&L curve (chronological) for visualisation. */
  pnlCurve: { idx: number; ts: number | null; cumulativePnlCents: number; pnlCents: number }[];
  /** EV vs RV per segment-by-source (or overall) for the line chart. */
  evVsRv: { segment: string; ev: number | null; rv: number | null }[];
  notes: string[];
}

export async function buildEdgeValidationReport(filters: EdgeValidationFilters = {}): Promise<EdgeValidationReport> {
  const trades = await loadTrades(filters);
  await attachCalibration(trades);

  const overall = statsOver('overall', trades);

  const bucketByKey = <K extends keyof SettledTrade>(k: K, labels?: string[]): { label: string; trades: SettledTrade[] }[] => {
    const groups = new Map<string, SettledTrade[]>();
    for (const t of trades) {
      const v = t[k];
      if (v == null || v === '') continue;
      const key = String(v);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const ordered = labels ?? Array.from(groups.keys()).sort();
    return ordered.filter(l => groups.has(l)).map(label => ({ label, trades: groups.get(label)! }));
  };

  const bySource     = bucketByKey('signalSource', ['kalshi', 'sportsbook']).map(g => statsOver(g.label, g.trades));
  const byConfidence = bucketByKey('confidence',   ['low', 'medium', 'high']).map(g => statsOver(g.label, g.trades));
  const byTier       = bucketByKey('sizingTier',   ['no-trade', 'small', 'medium', 'large']).map(g => statsOver(g.label, g.trades));

  const byEdgeBucket: SegmentStats[] = EDGE_BUCKETS.map(b => {
    const subset = trades.filter(t => {
      const e = t.calibratedEdge ?? t.expectedEdge;
      return e != null && Math.abs(e) >= b.min && Math.abs(e) < b.max;
    });
    return statsOver(b.label, subset);
  });

  const byHorizon: SegmentStats[] = HORIZON_BUCKETS.map(b => {
    const subset = trades.filter(t => t.leadTimeHours != null && t.leadTimeHours >= b.minHours && t.leadTimeHours < b.maxHours);
    return statsOver(b.label, subset);
  });

  // Cumulative P&L curve (chronological)
  const settledChrono = trades
    .filter(t => t.pnlCents != null)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  let cum = 0;
  const pnlCurve = settledChrono.map((t, i) => {
    cum += t.pnlCents as number;
    return { idx: i + 1, ts: t.timestamp ?? null, cumulativePnlCents: cum, pnlCents: t.pnlCents as number };
  });

  // EV vs RV across the source breakdown (most natural compact view)
  const evVsRv = bySource.map(s => ({ segment: s.segment, ev: s.expectedEdge, rv: s.realizedEdge }));

  const notes = [
    `Minimum sample size for a verdict: ${MIN_SAMPLE} resolved trades. Pushes (pnl = 0) are excluded from the win-rate denominator.`,
    'EV uses each trade\'s calibratedEdge when calibration context is available; otherwise it falls back to the candidate\'s pre-trade edge.',
    'RV is computed as realized hit rate minus 0.5 — this puts realized performance in the same units as EV (both are excess over a 50/50 baseline).',
    'SE is on the hit rate; the 95% CI is therefore a hit-rate band. Z is computed as (RV − EV) / SE.',
    'p-values use a two-tailed normal-CDF approximation (Abramowitz & Stegun 26.2.17); they are approximate and should not be the sole basis for parameter changes.',
    'Sharpe-like ratio is mean(pnlCents) / std(pnlCents) across settled trades and is informational only — it does not annualize.',
    `Evidence labels: <30 = ${evidenceLabel('insufficient')}; 30–99 = ${evidenceLabel('early')}; 100–199 = ${evidenceLabel('moderate')}; 200+ = ${evidenceLabel('stronger')}. Nothing is ever labeled "proven."`,
    'Read-only analytics. This report does not change ranking, scoring, sizing, risk, or execution behavior.',
  ];

  return {
    generatedAt: new Date().toISOString(),
    filters,
    overall,
    bySource,
    byConfidence,
    byTier,
    byEdgeBucket,
    byHorizon,
    pnlCurve,
    evVsRv,
    notes,
  };
}
