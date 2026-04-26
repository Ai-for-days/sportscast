// ── Step 69: Signal Reliability + Calibration Lab ───────────────────────────
//
// Analysis-only library. Pulls resolved demo + live orders, joins with
// execution candidates and settlements, and produces:
//
//   1. Probability calibration (7 buckets) — does observed YES frequency
//      match the model's predicted probability?
//   2. Edge correlation (6 buckets) — does larger pre-trade edge actually
//      produce more wins / better realized P&L?
//   3. Confidence calibration (3 levels) — do "high" signals win more
//      often than "medium" / "low"?
//   4. Horizon decay (5 buckets) — does forecast skill degrade with lead time?
//   5. Segment reliability — Brier score by location / metric / forecast source.
//
// No execution behavior is changed by this module. It is read-only quant analysis.
//
// Sample-size labels:
//   <30          insufficient data
//   30–99        early evidence
//   100–199      moderate evidence
//   200+         stronger evidence
//
// We never label anything "proven."

import { getRedis } from './redis';
import type { ExecutionCandidate } from './order-builder';

// ── Bucket definitions (Step 69 spec) ───────────────────────────────────────

export const PROB_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–10%',   min: 0.00, max: 0.10 },
  { label: '10–25%',  min: 0.10, max: 0.25 },
  { label: '25–40%',  min: 0.25, max: 0.40 },
  { label: '40–55%',  min: 0.40, max: 0.55 },
  { label: '55–70%',  min: 0.55, max: 0.70 },
  { label: '70–85%',  min: 0.70, max: 0.85 },
  { label: '85–100%', min: 0.85, max: 1.0001 },
];

export const EDGE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '<2¢',    min: 0.000, max: 0.020 },
  { label: '2–5¢',   min: 0.020, max: 0.050 },
  { label: '5–10¢',  min: 0.050, max: 0.100 },
  { label: '10–15¢', min: 0.100, max: 0.150 },
  { label: '15–25¢', min: 0.150, max: 0.250 },
  { label: '>25¢',   min: 0.250, max: Infinity },
];

export const HORIZON_BUCKETS: { label: string; minHours: number; maxHours: number }[] = [
  { label: '0–12h',  minHours: 0,   maxHours: 12 },
  { label: '12–24h', minHours: 12,  maxHours: 24 },
  { label: '1–3d',   minHours: 24,  maxHours: 72 },
  { label: '3–7d',   minHours: 72,  maxHours: 168 },
  { label: '7–15d',  minHours: 168, maxHours: 360 },
];

// ── Evidence labels ─────────────────────────────────────────────────────────

export type EvidenceLevel = 'insufficient' | 'early' | 'moderate' | 'stronger';

export function evidenceLevel(n: number): EvidenceLevel {
  if (n >= 200) return 'stronger';
  if (n >= 100) return 'moderate';
  if (n >= 30)  return 'early';
  return 'insufficient';
}

export function evidenceLabel(level: EvidenceLevel): string {
  switch (level) {
    case 'stronger':     return 'Stronger evidence';
    case 'moderate':     return 'Moderate evidence';
    case 'early':        return 'Early evidence';
    case 'insufficient': return 'Insufficient data';
  }
}

// ── Resolved record shape ───────────────────────────────────────────────────

interface ResolvedRecord {
  orderId: string;
  candidateId?: string;
  ticker?: string;
  side?: 'yes' | 'no' | string;
  modelProbYes?: number;
  modelProbNo?: number;
  modelProbForSide?: number; // probability assigned to the side actually traded
  edge?: number;
  confidence?: 'low' | 'medium' | 'high' | string;
  locationName?: string;
  metric?: string;
  forecastSource?: string;
  leadTimeHours?: number;
  pnlCents?: number;
  outcomeYes?: 0 | 1; // 1 if YES contract resolved truthy, 0 otherwise
  resolved: boolean;
}

// ── Data loaders ────────────────────────────────────────────────────────────

async function loadOrders() {
  const redis = getRedis();
  const demoCount = await redis.zcard('kalshi:demo:orders');
  const demoIds = demoCount > 0
    ? await redis.zrange('kalshi:demo:orders', 0, Math.min(demoCount, 500) - 1, { rev: true })
    : [];
  const liveCount = await redis.zcard('kalshi:live:orders');
  const liveIds = liveCount > 0
    ? await redis.zrange('kalshi:live:orders', 0, Math.min(liveCount, 500) - 1, { rev: true })
    : [];

  const demo: any[] = [];
  for (const id of demoIds) {
    const raw = await redis.get(`kalshi:demo:order:${id}`);
    if (raw) demo.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  const live: any[] = [];
  for (const id of liveIds) {
    const raw = await redis.get(`kalshi:live:order:${id}`);
    if (raw) live.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return { demo, live };
}

async function loadCandidates(): Promise<Record<string, ExecutionCandidate>> {
  const redis = getRedis();
  const candCount = await redis.zcard('exec:candidates:all');
  const candIds = candCount > 0
    ? await redis.zrange('exec:candidates:all', 0, Math.min(candCount, 500) - 1, { rev: true })
    : [];
  const map: Record<string, ExecutionCandidate> = {};
  for (const id of candIds) {
    const raw = await redis.get(`exec:candidate:${id}`);
    if (raw) {
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      map[c.id] = c as ExecutionCandidate;
    }
  }
  return map;
}

async function loadSettlements(): Promise<any[]> {
  const redis = getRedis();
  const count = await redis.zcard('settlements:all');
  const ids = count > 0
    ? await redis.zrange('settlements:all', 0, Math.min(count, 500) - 1, { rev: true })
    : [];
  const out: any[] = [];
  for (const id of ids) {
    const raw = await redis.get(`settlement:${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Build resolved records ──────────────────────────────────────────────────

function leadTimeHours(orderTimestamp: number | undefined, targetDate: string | undefined): number | undefined {
  if (!orderTimestamp || !targetDate) return undefined;
  // targetDate is "YYYY-MM-DD" for daily markets; fall back to noon UTC
  const target = new Date(`${targetDate}T12:00:00Z`).getTime();
  if (isNaN(target)) return undefined;
  const ms = target - orderTimestamp;
  return Math.max(0, ms / 3_600_000);
}

async function loadResolvedRecords(sinceTimestamp?: number): Promise<ResolvedRecord[]> {
  const [{ demo, live }, candidates, settlements] = await Promise.all([
    loadOrders(),
    loadCandidates(),
    loadSettlements(),
  ]);

  const allOrders = [
    ...demo.map(o => ({ ...o, orderSource: 'demo' })),
    ...live.map(o => ({ ...o, orderSource: 'live' })),
  ];

  const settBy = new Map<string, any>();
  for (const s of settlements) {
    if (s.orderId) settBy.set(s.orderId, s);
  }

  // Step 70: optional rolling-window filter on order timestamp
  const filtered = sinceTimestamp != null
    ? allOrders.filter(o => {
        const t = (o.timestamp ?? o.createdAt) as number | undefined;
        return t != null && t >= sinceTimestamp;
      })
    : allOrders;

  return filtered.map(o => {
    const cand = o.candidateId ? candidates[o.candidateId] : undefined;
    const sett = settBy.get(o.id);
    const side = o.side as 'yes' | 'no' | undefined;
    const modelProbYes = cand?.marketSnapshot?.modelProbYes;
    const modelProbNo = cand?.marketSnapshot?.modelProbNo;
    const modelProbForSide = side === 'yes' ? modelProbYes : side === 'no' ? modelProbNo : undefined;

    const pnlCents: number | undefined = sett?.netPnlCents;
    let outcomeYes: 0 | 1 | undefined;
    // Resolve YES/NO outcome from the realized P&L:
    //  - YES position with positive P&L => YES contract paid => outcomeYes = 1
    //  - YES position with negative P&L => YES did not resolve => outcomeYes = 0
    //  - NO position with positive P&L => YES did not resolve => outcomeYes = 0
    //  - NO position with negative P&L => YES resolved => outcomeYes = 1
    // Pushes (P&L = 0) are excluded from calibration math.
    if (pnlCents != null && pnlCents !== 0 && side) {
      const won = pnlCents > 0;
      outcomeYes = (side === 'yes') === won ? 1 : 0;
    }

    return {
      orderId: o.id,
      candidateId: o.candidateId,
      ticker: o.ticker,
      side,
      modelProbYes,
      modelProbNo,
      modelProbForSide,
      edge: cand?.edge,
      confidence: cand?.confidence,
      locationName: cand?.locationName,
      metric: cand?.metric,
      forecastSource: (cand as any)?.forecastSource ?? (cand as any)?.source,
      leadTimeHours: leadTimeHours(o.timestamp ?? o.createdAt, cand?.targetDate),
      pnlCents,
      outcomeYes,
      resolved: outcomeYes !== undefined,
    };
  });
}

// ── Bucket builders ─────────────────────────────────────────────────────────

interface ProbBucketRow {
  bucket: string;
  midpoint: number;
  count: number;
  observedYesRate: number | null;
  predictedAvg: number | null;
  brierContribution: number | null;
  evidence: EvidenceLevel;
}

function buildProbCalibration(records: ResolvedRecord[]): ProbBucketRow[] {
  const usable = records.filter(r => r.resolved && r.modelProbForSide != null && r.outcomeYes !== undefined);
  return PROB_BUCKETS.map(b => {
    // For probability calibration we always look at "model's prob for the YES outcome",
    // independent of which side was traded. So normalize:
    //   probYesEffective = side === 'yes' ? modelProbForSide : 1 - modelProbForSide
    const inBucket = usable.filter(r => {
      const probYesEffective = r.side === 'yes' ? r.modelProbForSide! : 1 - r.modelProbForSide!;
      return probYesEffective >= b.min && probYesEffective < b.max;
    });
    const n = inBucket.length;
    if (n === 0) {
      return {
        bucket: b.label,
        midpoint: (b.min + Math.min(b.max, 1)) / 2,
        count: 0,
        observedYesRate: null,
        predictedAvg: null,
        brierContribution: null,
        evidence: evidenceLevel(0),
      };
    }
    const yesCount = inBucket.filter(r => r.outcomeYes === 1).length;
    const observed = yesCount / n;
    const predictedAvg = inBucket.reduce((s, r) => {
      const probYesEff = r.side === 'yes' ? r.modelProbForSide! : 1 - r.modelProbForSide!;
      return s + probYesEff;
    }, 0) / n;
    // Brier contribution is mean squared error between predicted prob and outcome
    const brier = inBucket.reduce((s, r) => {
      const probYesEff = r.side === 'yes' ? r.modelProbForSide! : 1 - r.modelProbForSide!;
      return s + (probYesEff - (r.outcomeYes ?? 0)) ** 2;
    }, 0) / n;
    return {
      bucket: b.label,
      midpoint: (b.min + Math.min(b.max, 1)) / 2,
      count: n,
      observedYesRate: Math.round(observed * 1000) / 1000,
      predictedAvg: Math.round(predictedAvg * 1000) / 1000,
      brierContribution: Math.round(brier * 10000) / 10000,
      evidence: evidenceLevel(n),
    };
  });
}

interface EdgeBucketRow {
  bucket: string;
  count: number;
  withPnl: number;
  wins: number;
  hitRate: number | null;
  avgPnlCents: number | null;
  evidence: EvidenceLevel;
}

function buildEdgeBuckets(records: ResolvedRecord[]): EdgeBucketRow[] {
  const withEdge = records.filter(r => r.edge != null);
  return EDGE_BUCKETS.map(b => {
    const inBucket = withEdge.filter(r => {
      const e = Math.abs(r.edge!);
      return e >= b.min && e < b.max;
    });
    const withPnl = inBucket.filter(r => r.pnlCents != null);
    const wins = withPnl.filter(r => (r.pnlCents as number) > 0).length;
    return {
      bucket: b.label,
      count: inBucket.length,
      withPnl: withPnl.length,
      wins,
      hitRate: withPnl.length > 0 ? Math.round((wins / withPnl.length) * 1000) / 10 : null,
      avgPnlCents: withPnl.length > 0 ? Math.round(withPnl.reduce((s, r) => s + (r.pnlCents as number), 0) / withPnl.length) : null,
      evidence: evidenceLevel(withPnl.length),
    };
  });
}

interface ConfidenceBucketRow {
  confidence: 'low' | 'medium' | 'high';
  count: number;
  withPnl: number;
  wins: number;
  hitRate: number | null;
  avgPnlCents: number | null;
  evidence: EvidenceLevel;
}

function buildConfidenceBuckets(records: ResolvedRecord[]): ConfidenceBucketRow[] {
  return (['low', 'medium', 'high'] as const).map(c => {
    const inBucket = records.filter(r => r.confidence === c);
    const withPnl = inBucket.filter(r => r.pnlCents != null);
    const wins = withPnl.filter(r => (r.pnlCents as number) > 0).length;
    return {
      confidence: c,
      count: inBucket.length,
      withPnl: withPnl.length,
      wins,
      hitRate: withPnl.length > 0 ? Math.round((wins / withPnl.length) * 1000) / 10 : null,
      avgPnlCents: withPnl.length > 0 ? Math.round(withPnl.reduce((s, r) => s + (r.pnlCents as number), 0) / withPnl.length) : null,
      evidence: evidenceLevel(withPnl.length),
    };
  });
}

interface HorizonBucketRow {
  bucket: string;
  count: number;
  withPnl: number;
  wins: number;
  hitRate: number | null;
  avgEdgeBps: number | null;
  evidence: EvidenceLevel;
}

function buildHorizonBuckets(records: ResolvedRecord[]): HorizonBucketRow[] {
  const withHorizon = records.filter(r => r.leadTimeHours != null);
  return HORIZON_BUCKETS.map(b => {
    const inBucket = withHorizon.filter(r => r.leadTimeHours! >= b.minHours && r.leadTimeHours! < b.maxHours);
    const withPnl = inBucket.filter(r => r.pnlCents != null);
    const wins = withPnl.filter(r => (r.pnlCents as number) > 0).length;
    const withEdgeAndPnl = withPnl.filter(r => r.edge != null);
    return {
      bucket: b.label,
      count: inBucket.length,
      withPnl: withPnl.length,
      wins,
      hitRate: withPnl.length > 0 ? Math.round((wins / withPnl.length) * 1000) / 10 : null,
      avgEdgeBps: withEdgeAndPnl.length > 0 ? Math.round(withEdgeAndPnl.reduce((s, r) => s + Math.abs(r.edge as number), 0) / withEdgeAndPnl.length * 10000) : null,
      evidence: evidenceLevel(withPnl.length),
    };
  });
}

interface SegmentRow {
  segmentType: 'location' | 'metric' | 'source';
  segment: string;
  count: number;
  withOutcome: number;
  brierScore: number | null;
  hitRate: number | null;
  evidence: EvidenceLevel;
}

function buildSegmentReliability(records: ResolvedRecord[]): SegmentRow[] {
  const out: SegmentRow[] = [];
  const groups: { type: SegmentRow['segmentType']; key: (r: ResolvedRecord) => string | undefined }[] = [
    { type: 'location', key: r => r.locationName },
    { type: 'metric',   key: r => r.metric },
    { type: 'source',   key: r => r.forecastSource },
  ];
  for (const g of groups) {
    const buckets = new Map<string, ResolvedRecord[]>();
    for (const r of records) {
      const k = g.key(r);
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k)!.push(r);
    }
    for (const [segment, rs] of buckets.entries()) {
      const withOutcome = rs.filter(r => r.resolved && r.modelProbForSide != null);
      let brier: number | null = null;
      if (withOutcome.length > 0) {
        brier = withOutcome.reduce((s, r) => {
          const probYesEff = r.side === 'yes' ? r.modelProbForSide! : 1 - r.modelProbForSide!;
          return s + (probYesEff - (r.outcomeYes ?? 0)) ** 2;
        }, 0) / withOutcome.length;
        brier = Math.round(brier * 10000) / 10000;
      }
      const withPnl = rs.filter(r => r.pnlCents != null);
      const wins = withPnl.filter(r => (r.pnlCents as number) > 0).length;
      out.push({
        segmentType: g.type,
        segment,
        count: rs.length,
        withOutcome: withOutcome.length,
        brierScore: brier,
        hitRate: withPnl.length > 0 ? Math.round((wins / withPnl.length) * 1000) / 10 : null,
        evidence: evidenceLevel(withOutcome.length),
      });
    }
  }
  // Sort: highest Brier (least reliable) first, then by sample size desc.
  out.sort((a, b) => {
    const aB = a.brierScore ?? -1;
    const bB = b.brierScore ?? -1;
    if (bB !== aB) return bB - aB;
    return b.count - a.count;
  });
  return out;
}

// ── Top-level report ────────────────────────────────────────────────────────

export interface CalibrationReport {
  generatedAt: string;
  summary: {
    totalOrders: number;
    resolved: number;
    withModelProb: number;
    withEdge: number;
    overallEvidence: EvidenceLevel;
    overallEvidenceLabel: string;
    overallBrier: number | null;
  };
  probabilityCalibration: ProbBucketRow[];
  edgeBuckets: EdgeBucketRow[];
  confidenceBuckets: ConfidenceBucketRow[];
  horizonBuckets: HorizonBucketRow[];
  segmentReliability: SegmentRow[];
  notes: string[];
}

export async function buildCalibrationReport(sinceTimestamp?: number): Promise<CalibrationReport> {
  const records = await loadResolvedRecords(sinceTimestamp);
  const resolved = records.filter(r => r.resolved);
  const withModelProb = resolved.filter(r => r.modelProbForSide != null);
  const withEdge = records.filter(r => r.edge != null);

  const overallBrier = withModelProb.length > 0
    ? Math.round(withModelProb.reduce((s, r) => {
        const probYesEff = r.side === 'yes' ? r.modelProbForSide! : 1 - r.modelProbForSide!;
        return s + (probYesEff - (r.outcomeYes ?? 0)) ** 2;
      }, 0) / withModelProb.length * 10000) / 10000
    : null;

  const overallEv = evidenceLevel(withModelProb.length);

  const notes = [
    'Step 69 is analysis-only — no execution behavior, automatic trading, repricing, model promotion, or risk-limit changes were modified by this lab.',
    'Probability calibration uses the model probability assigned to the YES outcome (regardless of which side was traded). Pushes are excluded.',
    'Edge correlation buckets are defined in cents (Kalshi-style); a "5–10¢" edge means the model thought the contract was 5–10¢ mispriced.',
    'Brier scores are mean squared error between predicted YES probability and realized YES outcome. Lower is better; a coin-flip baseline is 0.25.',
    'Segment reliability sorts the LEAST reliable segments first — flagging where the model has been most wrong.',
    `Evidence labels: <30 = ${evidenceLabel('insufficient')}; 30–99 = ${evidenceLabel('early')}; 100–199 = ${evidenceLabel('moderate')}; 200+ = ${evidenceLabel('stronger')}. Nothing is ever labeled "proven."`,
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOrders: records.length,
      resolved: resolved.length,
      withModelProb: withModelProb.length,
      withEdge: withEdge.length,
      overallEvidence: overallEv,
      overallEvidenceLabel: evidenceLabel(overallEv),
      overallBrier,
    },
    probabilityCalibration: buildProbCalibration(records),
    edgeBuckets: buildEdgeBuckets(records),
    confidenceBuckets: buildConfidenceBuckets(records),
    horizonBuckets: buildHorizonBuckets(records),
    segmentReliability: buildSegmentReliability(records),
    notes,
  };
}
