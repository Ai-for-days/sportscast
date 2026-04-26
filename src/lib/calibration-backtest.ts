// ── Step 72: Calibration Backtest + Model Adjustment Recommendations ────────
//
// Research-only layer. Asks "did Steps 69–71 actually help?" by replaying
// the resolved-record corpus through both the raw and the calibration-aware
// scoring strategies, then producing diagnostics and human-review-only
// recommendations.
//
// CRITICAL CONSTRAINTS
//   - No autonomous trading
//   - No automatic filtering
//   - No execution changes
//   - No risk-limit changes
//   - No automatic model promotion
//   - No threshold changes applied automatically
//
// All recommendations carry `autoApplied: false` and require operator review.

import {
  PROB_BUCKETS, EDGE_BUCKETS, HORIZON_BUCKETS,
  buildCalibrationReport,
  evidenceLevel, evidenceLabel,
  type CalibrationReport, type EvidenceLevel,
} from './calibration-lab';
import { getRedis } from './redis';
import { RANKING_WEIGHTS } from './signal-ranking';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SAMPLES_FOR_FACTOR = 30; // matches signal-calibration

// ── Filter inputs ───────────────────────────────────────────────────────────

export interface BacktestFilters {
  dateFrom?: string;     // ISO yyyy-mm-dd or full ISO
  dateTo?: string;
  source?: string;       // forecast source filter
  metric?: string;
  location?: string;     // substring match on locationName
  minSampleSize?: number;
  mode?: 'all' | 'demo' | 'live';
}

// ── Internal record shape (richer than the lab's ResolvedRecord) ────────────

interface BacktestRecord {
  orderId: string;
  orderSource: 'demo' | 'live';
  ticker?: string;
  side?: 'yes' | 'no';
  modelProbYes?: number;
  modelProbNo?: number;
  modelProbForSide?: number;
  marketProbForSide?: number;
  rawEdge?: number;
  confidence?: 'low' | 'medium' | 'high' | string;
  locationName?: string;
  metric?: string;
  forecastSource?: string;
  leadTimeHours?: number;
  timestamp?: number;
  pnlCents?: number;
  outcomeYes?: 0 | 1;
  resolved: boolean;

  // Step 72: per-record reconstruction of the calibration components
  // (using current calibration history). Shrunk model prob = modelProb
  // pulled toward 0.5 by (1 - reliabilityFactor).
  probFactor?: number;
  edgeFactor?: number;
  horizonFactor?: number;
  reliabilityFactor: number;
  calibratedEdge?: number;
  shrunkProbForSide?: number;

  // Step 71 outcome
  wouldBeNoTrade: boolean;        // reliabilityFactor < 0.25
  wouldBeTierCappedSmall: boolean; // 0.25 ≤ rf < 0.4 (downgrade large/medium → small)
  wouldBeTierCappedMedium: boolean; // 0.4 ≤ rf < 0.6 (downgrade large → medium)
  wouldBeScorePenalized: boolean;  // rf < 0.5
  downgraded: boolean;             // any of the above
}

// ── Loader (reads same Redis keys as calibration-lab) ───────────────────────

async function loadOrders(mode: BacktestFilters['mode']) {
  const redis = getRedis();
  const out: { source: 'demo' | 'live'; o: any }[] = [];
  if (mode !== 'live') {
    const c = await redis.zcard('kalshi:demo:orders');
    const ids = c > 0 ? await redis.zrange('kalshi:demo:orders', 0, Math.min(c, 1000) - 1, { rev: true }) : [];
    for (const id of ids) {
      const raw = await redis.get(`kalshi:demo:order:${id}`);
      if (raw) out.push({ source: 'demo', o: typeof raw === 'string' ? JSON.parse(raw) : raw });
    }
  }
  if (mode !== 'demo') {
    const c = await redis.zcard('kalshi:live:orders');
    const ids = c > 0 ? await redis.zrange('kalshi:live:orders', 0, Math.min(c, 1000) - 1, { rev: true }) : [];
    for (const id of ids) {
      const raw = await redis.get(`kalshi:live:order:${id}`);
      if (raw) out.push({ source: 'live', o: typeof raw === 'string' ? JSON.parse(raw) : raw });
    }
  }
  return out;
}

async function loadCandidates(): Promise<Record<string, any>> {
  const redis = getRedis();
  const c = await redis.zcard('exec:candidates:all');
  const ids = c > 0 ? await redis.zrange('exec:candidates:all', 0, Math.min(c, 1000) - 1, { rev: true }) : [];
  const map: Record<string, any> = {};
  for (const id of ids) {
    const raw = await redis.get(`exec:candidate:${id}`);
    if (raw) {
      const cand = typeof raw === 'string' ? JSON.parse(raw) : raw;
      map[cand.id] = cand;
    }
  }
  return map;
}

async function loadSettlements(): Promise<Map<string, any>> {
  const redis = getRedis();
  const c = await redis.zcard('settlements:all');
  const ids = c > 0 ? await redis.zrange('settlements:all', 0, Math.min(c, 1000) - 1, { rev: true }) : [];
  const map = new Map<string, any>();
  for (const id of ids) {
    const raw = await redis.get(`settlement:${id}`);
    if (raw) {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (s.orderId) map.set(s.orderId, s);
    }
  }
  return map;
}

// ── Bucket lookups (mirror signal-calibration without re-importing internals) ─

function probBucketIndex(probYesEffective?: number): number | null {
  if (probYesEffective == null) return null;
  for (let i = 0; i < PROB_BUCKETS.length; i++) {
    const b = PROB_BUCKETS[i];
    if (probYesEffective >= b.min && probYesEffective < b.max) return i;
  }
  return null;
}
function edgeBucketIndex(rawEdge?: number): number | null {
  if (rawEdge == null) return null;
  const e = Math.abs(rawEdge);
  for (let i = 0; i < EDGE_BUCKETS.length; i++) {
    const b = EDGE_BUCKETS[i];
    if (e >= b.min && e < b.max) return i;
  }
  return null;
}
function horizonBucketIndex(leadHours?: number): number | null {
  if (leadHours == null) return null;
  for (let i = 0; i < HORIZON_BUCKETS.length; i++) {
    const b = HORIZON_BUCKETS[i];
    if (leadHours >= b.minHours && leadHours < b.maxHours) return i;
  }
  return null;
}
function clamp01(x: number): number { return Number.isNaN(x) ? 0 : Math.max(0, Math.min(1, x)); }
function calibrationMissToFactor(absMiss: number): number { return clamp01(1 - absMiss * 4); }
function hitRateToFactor(hitRatePct: number): number { return clamp01((hitRatePct - 30) / 40); }

interface PickedRow<T> { row: T; window: '7-day' | '30-day' | 'all-time'; }
function pickWindow<T extends { count?: number; withPnl?: number }>(
  rowKey: 'count' | 'withPnl',
  windows: { rep: CalibrationReport; label: PickedRow<T>['window'] }[],
  getter: (r: CalibrationReport) => T,
): PickedRow<T> | null {
  for (const c of windows) {
    const r = getter(c.rep);
    const n = (r as any)[rowKey] ?? 0;
    if (n >= MIN_SAMPLES_FOR_FACTOR) return { row: r, window: c.label };
  }
  return null;
}

// ── Build the backtest record set ───────────────────────────────────────────

async function buildRecords(filters: BacktestFilters): Promise<{
  records: BacktestRecord[];
  windows: { sevenDay: CalibrationReport; thirtyDay: CalibrationReport; allTime: CalibrationReport };
}> {
  const now = Date.now();
  const [orders, candidates, settlements, sevenDay, thirtyDay, allTime] = await Promise.all([
    loadOrders(filters.mode ?? 'all'),
    loadCandidates(),
    loadSettlements(),
    buildCalibrationReport(now - 7  * DAY_MS),
    buildCalibrationReport(now - 30 * DAY_MS),
    buildCalibrationReport(),
  ]);

  const dateFromMs = filters.dateFrom ? new Date(filters.dateFrom).getTime() : undefined;
  const dateToMs = filters.dateTo ? new Date(filters.dateTo).getTime() + DAY_MS - 1 : undefined; // inclusive end-of-day

  const records: BacktestRecord[] = [];
  const winList: { rep: CalibrationReport; label: '7-day' | '30-day' | 'all-time' }[] = [
    { rep: sevenDay,  label: '7-day' },
    { rep: thirtyDay, label: '30-day' },
    { rep: allTime,   label: 'all-time' },
  ];

  for (const { source: orderSource, o } of orders) {
    const cand = o.candidateId ? candidates[o.candidateId] : undefined;
    const sett = settlements.get(o.id);
    const side = o.side as 'yes' | 'no' | undefined;

    // Filter pass
    const ts = (o.timestamp ?? o.createdAt) as number | undefined;
    if (dateFromMs != null && (ts == null || ts < dateFromMs)) continue;
    if (dateToMs != null   && (ts == null || ts > dateToMs))   continue;
    if (filters.source   && cand?.forecastSource !== filters.source && cand?.source !== filters.source) continue;
    if (filters.metric   && cand?.metric !== filters.metric) continue;
    if (filters.location && !(cand?.locationName ?? '').toLowerCase().includes(filters.location.toLowerCase())) continue;

    const modelProbYes = cand?.marketSnapshot?.modelProbYes;
    const modelProbNo  = cand?.marketSnapshot?.modelProbNo;
    const marketProbYes = cand?.marketSnapshot?.marketProbYes;
    const marketProbNo  = cand?.marketSnapshot?.marketProbNo;
    const modelProbForSide  = side === 'yes' ? modelProbYes  : side === 'no' ? modelProbNo  : undefined;
    const marketProbForSide = side === 'yes' ? marketProbYes : side === 'no' ? marketProbNo : undefined;
    const probYesEffective = modelProbForSide != null
      ? side === 'yes' ? modelProbForSide : 1 - modelProbForSide
      : undefined;

    const rawEdge: number | undefined = cand?.edge;
    const leadTimeHours = (() => {
      if (!cand?.targetDate || !ts) return undefined;
      const t = new Date(`${cand.targetDate}T12:00:00Z`).getTime();
      if (Number.isNaN(t)) return undefined;
      return Math.max(0, (t - ts) / 3_600_000);
    })();

    // Component factors at the time of analysis (replay against current history)
    let probFactor: number | undefined;
    let edgeFactor: number | undefined;
    let horizonFactor: number | undefined;

    const probIdx = probBucketIndex(probYesEffective);
    if (probIdx != null) {
      const pick = pickWindow('count', winList, r => r.probabilityCalibration[probIdx]);
      if (pick && pick.row.observedYesRate != null && pick.row.predictedAvg != null) {
        probFactor = calibrationMissToFactor(Math.abs(pick.row.observedYesRate - pick.row.predictedAvg));
      }
    }
    const edgeIdx = edgeBucketIndex(rawEdge);
    if (edgeIdx != null) {
      const pick = pickWindow('withPnl', winList, r => r.edgeBuckets[edgeIdx]);
      if (pick && pick.row.hitRate != null) edgeFactor = hitRateToFactor(pick.row.hitRate);
    }
    const horizonIdx = horizonBucketIndex(leadTimeHours);
    if (horizonIdx != null) {
      const pick = pickWindow('withPnl', winList, r => r.horizonBuckets[horizonIdx]);
      if (pick && pick.row.hitRate != null) horizonFactor = hitRateToFactor(pick.row.hitRate);
    }

    const factors = [probFactor, edgeFactor, horizonFactor].filter((f): f is number => f != null);
    const reliabilityFactor = factors.length > 0
      ? Math.round((factors.reduce((s, f) => s + f, 0) / factors.length) * 100) / 100
      : 1.0;

    const calibratedEdge = rawEdge != null ? Math.round(rawEdge * reliabilityFactor * 10000) / 10000 : undefined;

    // Calibrated probability = shrink model prob toward 0.5 by (1 - rf).
    let shrunkProbForSide: number | undefined;
    if (modelProbForSide != null) {
      shrunkProbForSide = 0.5 + (modelProbForSide - 0.5) * reliabilityFactor;
    }

    const pnlCents: number | undefined = sett?.netPnlCents;
    let outcomeYes: 0 | 1 | undefined;
    if (pnlCents != null && pnlCents !== 0 && side) {
      const won = pnlCents > 0;
      outcomeYes = (side === 'yes') === won ? 1 : 0;
    }

    const wouldBeNoTrade = reliabilityFactor < RANKING_WEIGHTS.RELIABILITY_CAP_NO_TRADE;
    const wouldBeTierCappedSmall = !wouldBeNoTrade && reliabilityFactor < RANKING_WEIGHTS.RELIABILITY_CAP_SMALL;
    const wouldBeTierCappedMedium = !wouldBeNoTrade && !wouldBeTierCappedSmall && reliabilityFactor < RANKING_WEIGHTS.RELIABILITY_CAP_MEDIUM;
    const wouldBeScorePenalized = reliabilityFactor < RANKING_WEIGHTS.RELIABILITY_PENALTY_THRESHOLD;
    const downgraded = wouldBeNoTrade || wouldBeTierCappedSmall || wouldBeTierCappedMedium || wouldBeScorePenalized;

    records.push({
      orderId: o.id,
      orderSource,
      ticker: o.ticker,
      side,
      modelProbYes, modelProbNo, modelProbForSide,
      marketProbForSide,
      rawEdge,
      confidence: cand?.confidence,
      locationName: cand?.locationName,
      metric: cand?.metric,
      forecastSource: cand?.forecastSource ?? cand?.source,
      leadTimeHours,
      timestamp: ts,
      pnlCents,
      outcomeYes,
      resolved: outcomeYes !== undefined,

      probFactor, edgeFactor, horizonFactor,
      reliabilityFactor,
      calibratedEdge,
      shrunkProbForSide,

      wouldBeNoTrade, wouldBeTierCappedSmall, wouldBeTierCappedMedium,
      wouldBeScorePenalized, downgraded,
    });
  }

  return { records, windows: { sevenDay, thirtyDay, allTime } };
}

// ── Strategy comparison ─────────────────────────────────────────────────────

interface StrategyStats {
  strategy: 'raw' | 'calibrated';
  total: number;
  resolved: number;
  withPnl: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
  avgEdge: number | null;
  brierScore: number | null;
  topDecileAvgPnl: number | null;
  topQuartileAvgPnl: number | null;
  evidence: EvidenceLevel;
  evidenceLabel: string;
}

function computeStrategyStats(strategy: 'raw' | 'calibrated', records: BacktestRecord[]): StrategyStats {
  // For "calibrated" we drop records that would have been no-trade under Step 71.
  const filtered = strategy === 'calibrated' ? records.filter(r => !r.wouldBeNoTrade) : records;
  const resolved = filtered.filter(r => r.resolved);
  const withPnl = filtered.filter(r => r.pnlCents != null);
  const wins = withPnl.filter(r => (r.pnlCents as number) > 0).length;
  const losses = withPnl.filter(r => (r.pnlCents as number) < 0).length;
  const totalPnl = withPnl.reduce((s, r) => s + (r.pnlCents as number), 0);
  const avgPnl = withPnl.length > 0 ? Math.round(totalPnl / withPnl.length) : null;

  const edgeKey = strategy === 'raw' ? 'rawEdge' : 'calibratedEdge';
  const probKey = strategy === 'raw' ? 'modelProbForSide' : 'shrunkProbForSide';

  const withEdge = filtered.filter(r => (r as any)[edgeKey] != null);
  const avgEdge = withEdge.length > 0
    ? Math.round((withEdge.reduce((s, r) => s + Math.abs((r as any)[edgeKey]), 0) / withEdge.length) * 10000) / 10000
    : null;

  // Brier (per-strategy)
  const withProb = filtered.filter(r => r.resolved && r.outcomeYes !== undefined && (r as any)[probKey] != null);
  let brier: number | null = null;
  if (withProb.length > 0) {
    brier = withProb.reduce((s, r) => {
      const p = (r as any)[probKey] as number;
      const probYesEff = r.side === 'yes' ? p : 1 - p;
      return s + (probYesEff - (r.outcomeYes ?? 0)) ** 2;
    }, 0) / withProb.length;
    brier = Math.round(brier * 10000) / 10000;
  }

  // Top-decile / quartile by edge (this strategy's edge field)
  const ranked = withEdge
    .filter(r => r.pnlCents != null)
    .sort((a, b) => Math.abs((b as any)[edgeKey]) - Math.abs((a as any)[edgeKey]));
  const tenth = Math.max(1, Math.floor(ranked.length * 0.10));
  const quarter = Math.max(1, Math.floor(ranked.length * 0.25));
  const topDecile = ranked.slice(0, tenth);
  const topQuartile = ranked.slice(0, quarter);
  const topDecileAvg = topDecile.length > 0 ? Math.round(topDecile.reduce((s, r) => s + (r.pnlCents as number), 0) / topDecile.length) : null;
  const topQuartileAvg = topQuartile.length > 0 ? Math.round(topQuartile.reduce((s, r) => s + (r.pnlCents as number), 0) / topQuartile.length) : null;

  const ev = evidenceLevel(withPnl.length);
  return {
    strategy,
    total: filtered.length,
    resolved: resolved.length,
    withPnl: withPnl.length,
    wins, losses,
    winRatePct: withPnl.length > 0 ? Math.round((wins / withPnl.length) * 1000) / 10 : null,
    totalPnlCents: totalPnl,
    avgPnlCents: avgPnl,
    avgEdge,
    brierScore: brier,
    topDecileAvgPnl: topDecileAvg,
    topQuartileAvgPnl: topQuartileAvg,
    evidence: ev,
    evidenceLabel: evidenceLabel(ev),
  };
}

// ── Reliability buckets ─────────────────────────────────────────────────────

const RELIABILITY_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0.00–0.25', min: 0.00, max: 0.25 },
  { label: '0.25–0.40', min: 0.25, max: 0.40 },
  { label: '0.40–0.60', min: 0.40, max: 0.60 },
  { label: '0.60–0.85', min: 0.60, max: 0.85 },
  { label: '0.85–1.00', min: 0.85, max: 1.0001 },
];

interface ReliabilityBucketRow {
  bucket: string;
  count: number;
  resolvedCount: number;
  withPnl: number;
  wins: number;
  winRatePct: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
  avgRawEdge: number | null;
  avgCalibratedEdge: number | null;
  evidence: EvidenceLevel;
  verdict: string;
}

function buildReliabilityBuckets(records: BacktestRecord[]): ReliabilityBucketRow[] {
  return RELIABILITY_BUCKETS.map(b => {
    const inBucket = records.filter(r => r.reliabilityFactor >= b.min && r.reliabilityFactor < b.max);
    const withPnl = inBucket.filter(r => r.pnlCents != null);
    const wins = withPnl.filter(r => (r.pnlCents as number) > 0).length;
    const totalPnl = withPnl.reduce((s, r) => s + (r.pnlCents as number), 0);
    const withRaw = inBucket.filter(r => r.rawEdge != null);
    const withCal = inBucket.filter(r => r.calibratedEdge != null);
    const winRate = withPnl.length > 0 ? (wins / withPnl.length) * 100 : null;

    let verdict: string;
    if (withPnl.length < MIN_SAMPLES_FOR_FACTOR) verdict = 'Insufficient data — verdict pending';
    else if (winRate == null) verdict = 'No P&L data';
    else if (totalPnl < 0) verdict = 'Negative P&L — current cap is justified';
    else if (winRate < 50) verdict = 'Win rate below 50% — cap appears justified';
    else verdict = 'Positive performance — cap may be conservative';

    return {
      bucket: b.label,
      count: inBucket.length,
      resolvedCount: inBucket.filter(r => r.resolved).length,
      withPnl: withPnl.length,
      wins,
      winRatePct: winRate != null ? Math.round(winRate * 10) / 10 : null,
      totalPnlCents: totalPnl,
      avgPnlCents: withPnl.length > 0 ? Math.round(totalPnl / withPnl.length) : null,
      avgRawEdge: withRaw.length > 0 ? Math.round(withRaw.reduce((s, r) => s + Math.abs(r.rawEdge as number), 0) / withRaw.length * 10000) / 10000 : null,
      avgCalibratedEdge: withCal.length > 0 ? Math.round(withCal.reduce((s, r) => s + Math.abs(r.calibratedEdge as number), 0) / withCal.length * 10000) / 10000 : null,
      evidence: evidenceLevel(withPnl.length),
      verdict,
    };
  });
}

// ── Component diagnostics ───────────────────────────────────────────────────

interface ComponentDiagnostic {
  component: 'probability' | 'edge' | 'horizon' | 'venue';
  recordsAffected: number;
  averageFactor: number | null;
  outcomeCorrelation: number | null;
  pnlCorrelation: number | null;
  evidence: EvidenceLevel;
  warning?: string;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return Math.round((num / Math.sqrt(dx2 * dy2)) * 1000) / 1000;
}

function buildComponentDiagnostics(records: BacktestRecord[]): ComponentDiagnostic[] {
  const make = (component: ComponentDiagnostic['component'], picker: (r: BacktestRecord) => number | undefined): ComponentDiagnostic => {
    const have = records.filter(r => picker(r) != null);
    const haveOutcome = have.filter(r => r.outcomeYes !== undefined);
    const havePnl = have.filter(r => r.pnlCents != null);
    const ev = evidenceLevel(haveOutcome.length);
    const avg = have.length > 0 ? Math.round((have.reduce((s, r) => s + (picker(r) as number), 0) / have.length) * 1000) / 1000 : null;
    const outcomeCorr = haveOutcome.length >= 5
      ? pearson(haveOutcome.map(r => picker(r) as number), haveOutcome.map(r => r.outcomeYes as number))
      : null;
    const pnlCorr = havePnl.length >= 5
      ? pearson(havePnl.map(r => picker(r) as number), havePnl.map(r => r.pnlCents as number))
      : null;
    return {
      component,
      recordsAffected: have.length,
      averageFactor: avg,
      outcomeCorrelation: outcomeCorr,
      pnlCorrelation: pnlCorr,
      evidence: ev,
      warning: ev === 'insufficient' ? 'Insufficient sample size — correlation values are unreliable' : undefined,
    };
  };
  return [
    make('probability', r => r.probFactor),
    make('edge',        r => r.edgeFactor),
    make('horizon',     r => r.horizonFactor),
    // Venue: we don't currently store venueAdjustment factor on candidates
    // (Step 69 lives at signal-ranking time). Surface a stub diagnostic with
    // a clear "untested" warning.
    {
      component: 'venue',
      recordsAffected: 0,
      averageFactor: null,
      outcomeCorrelation: null,
      pnlCorrelation: null,
      evidence: evidenceLevel(0),
      warning: 'Venue haircut is applied at signal-ranking time but is not persisted on stored candidates — diagnostics not yet supportable.',
    },
  ];
}

// ── Recommendation engine ───────────────────────────────────────────────────

export interface Recommendation {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'calibration' | 'edge' | 'horizon' | 'venue' | 'scoring' | 'sample_size';
  title: string;
  message: string;
  suggestedAction?: string;
  autoApplied: false;
}

function buildRecommendations(opts: {
  records: BacktestRecord[];
  raw: StrategyStats;
  calibrated: StrategyStats;
  buckets: ReliabilityBucketRow[];
  diagnostics: ComponentDiagnostic[];
}): Recommendation[] {
  const recs: Recommendation[] = [];
  const totalSamples = opts.raw.withPnl;

  // Sample-size gate
  if (totalSamples < MIN_SAMPLES_FOR_FACTOR) {
    recs.push({
      id: 'rec-sample-gate',
      severity: 'warning',
      category: 'sample_size',
      title: 'Insufficient overall sample size',
      message: `Only ${totalSamples} resolved records with P&L. Backtest results below this threshold are exploratory and should not drive parameter changes.`,
      suggestedAction: 'Continue running demo trades through full settlement to accumulate at least 30 resolved records before reviewing other recommendations.',
      autoApplied: false,
    });
  }

  // No-trade cap (0.0-0.25)
  const lowest = opts.buckets[0];
  if (lowest.withPnl >= MIN_SAMPLES_FOR_FACTOR && (lowest.totalPnlCents > 0 || (lowest.winRatePct ?? 0) > 50)) {
    recs.push({
      id: 'rec-cap-no-trade-loose',
      severity: 'info',
      category: 'scoring',
      title: 'Reliability cap <0.25 (no-trade) appears too strict',
      message: `Records in the 0.00–0.25 bucket showed positive performance (win ${lowest.winRatePct}%, total P&L ${lowest.totalPnlCents}¢) over ${lowest.withPnl} samples.`,
      suggestedAction: 'Consider relaxing RELIABILITY_CAP_NO_TRADE to 0.15 in a follow-up step — operator review required before applying.',
      autoApplied: false,
    });
  } else if (lowest.withPnl >= MIN_SAMPLES_FOR_FACTOR) {
    recs.push({
      id: 'rec-cap-no-trade-fits',
      severity: 'info',
      category: 'scoring',
      title: 'Reliability cap <0.25 looks correctly placed',
      message: `Records in the 0.00–0.25 bucket lost on average (win ${lowest.winRatePct ?? 0}%, total P&L ${lowest.totalPnlCents}¢, n=${lowest.withPnl}). Forcing no-trade is justified.`,
      autoApplied: false,
    });
  }

  // 0.40-0.60 bucket
  const midBucket = opts.buckets.find(b => b.bucket === '0.40–0.60');
  if (midBucket && midBucket.withPnl >= MIN_SAMPLES_FOR_FACTOR) {
    if (midBucket.totalPnlCents < 0) {
      recs.push({
        id: 'rec-mid-bucket-justified',
        severity: 'info',
        category: 'scoring',
        title: '0.40–0.60 reliability bucket has negative P&L',
        message: `Bucket showed total P&L of ${midBucket.totalPnlCents}¢ over ${midBucket.withPnl} settled trades. The current "cap at small" rule is justified by the data.`,
        autoApplied: false,
      });
    } else {
      recs.push({
        id: 'rec-mid-bucket-soft',
        severity: 'warning',
        category: 'scoring',
        title: '0.40–0.60 reliability bucket has positive P&L despite cap',
        message: `Bucket P&L is ${midBucket.totalPnlCents}¢ over ${midBucket.withPnl} trades (win ${midBucket.winRatePct}%). The "cap at small" rule may be removing tradable edge.`,
        suggestedAction: 'Review whether RELIABILITY_CAP_SMALL should be lowered after additional samples.',
        autoApplied: false,
      });
    }
  }

  // Top-decile vs raw
  if (opts.raw.topDecileAvgPnl != null && opts.calibrated.topDecileAvgPnl != null) {
    if (opts.calibrated.topDecileAvgPnl > opts.raw.topDecileAvgPnl) {
      recs.push({
        id: 'rec-top-decile-improved',
        severity: 'info',
        category: 'edge',
        title: 'Top-decile P&L improved under calibrated strategy',
        message: `Top 10% of signals by edge now averages ${opts.calibrated.topDecileAvgPnl}¢ P&L (vs ${opts.raw.topDecileAvgPnl}¢ raw). calibratedEdge is sorting more profitable signals to the top.`,
        autoApplied: false,
      });
    } else if (opts.calibrated.topDecileAvgPnl < opts.raw.topDecileAvgPnl) {
      recs.push({
        id: 'rec-top-decile-regressed',
        severity: 'warning',
        category: 'edge',
        title: 'Top-decile P&L regressed under calibrated strategy',
        message: `Top 10% by calibratedEdge averages ${opts.calibrated.topDecileAvgPnl}¢ vs ${opts.raw.topDecileAvgPnl}¢ raw. Calibration may be over-shrinking profitable signals.`,
        suggestedAction: 'Inspect component diagnostics — one of probFactor / edgeFactor / horizonFactor may be too aggressive.',
        autoApplied: false,
      });
    }
  }

  // Brier improvement
  if (opts.raw.brierScore != null && opts.calibrated.brierScore != null) {
    const delta = opts.raw.brierScore - opts.calibrated.brierScore;
    if (delta > 0.005) {
      recs.push({
        id: 'rec-brier-improved',
        severity: 'info',
        category: 'calibration',
        title: 'Calibrated probabilities reduced Brier score',
        message: `Brier dropped from ${opts.raw.brierScore.toFixed(4)} (raw) to ${opts.calibrated.brierScore.toFixed(4)} (calibrated) — a ${(delta).toFixed(4)} improvement.`,
        autoApplied: false,
      });
    } else if (delta < -0.005) {
      recs.push({
        id: 'rec-brier-regressed',
        severity: 'warning',
        category: 'calibration',
        title: 'Calibrated probabilities worsened Brier score',
        message: `Brier rose from ${opts.raw.brierScore.toFixed(4)} (raw) to ${opts.calibrated.brierScore.toFixed(4)} (calibrated). Probability shrinkage may be too aggressive.`,
        suggestedAction: 'Inspect probability bucket calibration — review whether probFactor formula needs tuning.',
        autoApplied: false,
      });
    }
  }

  // Component sample-size warnings
  for (const d of opts.diagnostics) {
    if (d.evidence === 'insufficient' && d.recordsAffected > 0) {
      recs.push({
        id: `rec-component-${d.component}-insufficient`,
        severity: 'info',
        category: d.component === 'venue' ? 'venue' : (d.component as 'calibration' | 'edge' | 'horizon'),
        title: `${d.component} component: insufficient sample size`,
        message: `Only ${d.recordsAffected} records carry a ${d.component} factor. Cannot meaningfully evaluate this component's contribution yet.`,
        autoApplied: false,
      });
    }
  }

  // Venue
  recs.push({
    id: 'rec-venue-untested',
    severity: 'info',
    category: 'venue',
    title: 'Indoor / retractable haircut is untested in this backtest',
    message: 'Venue haircut from Step 69 lives at signal-ranking time and is not persisted on stored execution candidates, so its empirical impact cannot be measured here.',
    suggestedAction: 'Future step: persist venueAdjustment metadata onto candidates so backtest can isolate its contribution.',
    autoApplied: false,
  });

  return recs;
}

// ── Top-level report ────────────────────────────────────────────────────────

export interface BacktestReport {
  generatedAt: string;
  filters: BacktestFilters;
  summary: {
    recordsAnalyzed: number;
    resolvedRecords: number;
    rawStrategyPnlCents: number;
    calibratedStrategyPnlCents: number;
    rawWinRatePct: number | null;
    calibratedWinRatePct: number | null;
    brierImprovement: number | null;
    signalsDowngraded: number;
    signalsDowngradedPct: number;
    correctDowngrades: number;
    falseDowngrades: number;
    correctDowngradesPct: number | null;
    falseDowngradesPct: number | null;
    recommendationCount: number;
    overallEvidence: EvidenceLevel;
    overallEvidenceLabel: string;
  };
  rawVsCalibrated: { raw: StrategyStats; calibrated: StrategyStats };
  reliabilityBuckets: ReliabilityBucketRow[];
  componentDiagnostics: ComponentDiagnostic[];
  recommendations: Recommendation[];
  // Step 73 visualization data
  severityCounts: { info: number; warning: number; critical: number };
  recentCandlesticks: { label: string; marketProb: number; modelProb: number; calibratedProb: number }[];
  edgeHorizonHeatmap: { edgeBucket: string; horizonBucket: string; avgPnlCents: number | null; sample: number }[];
  methodology: string[];
}

export async function buildCalibrationBacktestReport(filters: BacktestFilters = {}): Promise<BacktestReport> {
  const { records } = await buildRecords(filters);

  const raw = computeStrategyStats('raw', records);
  const calibrated = computeStrategyStats('calibrated', records);

  const buckets = buildReliabilityBuckets(records);
  const diagnostics = buildComponentDiagnostics(records);
  const recommendations = buildRecommendations({ records, raw, calibrated, buckets, diagnostics });

  // Downgrade attribution
  const downgraded = records.filter(r => r.downgraded);
  const downgradedWithPnl = downgraded.filter(r => r.pnlCents != null);
  const allWithPnl = records.filter(r => r.pnlCents != null);
  const allAvgPnl = allWithPnl.length > 0
    ? allWithPnl.reduce((s, r) => s + (r.pnlCents as number), 0) / allWithPnl.length
    : 0;

  // A "correct downgrade" lost / had negative P&L OR belonged to a bucket
  // that underperformed the average.
  const correctDowngrades = downgradedWithPnl.filter(r => {
    const lostMoney = (r.pnlCents as number) <= 0;
    return lostMoney; // simple rule: anything that lost money was correctly downgraded
  }).length;
  // A "false downgrade" won AND had positive P&L AND beat overall average
  const falseDowngrades = downgradedWithPnl.filter(r => {
    return (r.pnlCents as number) > 0 && (r.pnlCents as number) >= allAvgPnl;
  }).length;

  const brierImprovement = (raw.brierScore != null && calibrated.brierScore != null)
    ? Math.round((raw.brierScore - calibrated.brierScore) * 10000) / 10000
    : null;

  // Step 73: severity counts for visual grouping
  const severityCounts = {
    info: recommendations.filter(r => r.severity === 'info').length,
    warning: recommendations.filter(r => r.severity === 'warning').length,
    critical: recommendations.filter(r => r.severity === 'critical').length,
  };

  // Step 73: recent candlesticks (most recent N records that have all 3 probs)
  const recentCandlesticks = records
    .filter(r => r.marketProbForSide != null && r.modelProbForSide != null && r.shrunkProbForSide != null && r.timestamp != null)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 20)
    .reverse() // chronological for the chart left-to-right
    .map(r => {
      const inYesTerms = (p: number | undefined) =>
        p == null ? null : (r.side === 'yes' ? p : 1 - p);
      return {
        label: (r.ticker ?? r.orderId.slice(0, 6)).slice(0, 8),
        marketProb: inYesTerms(r.marketProbForSide) as number,
        modelProb: inYesTerms(r.modelProbForSide) as number,
        calibratedProb: inYesTerms(r.shrunkProbForSide) as number,
      };
    })
    .filter(c => c.marketProb != null && c.modelProb != null && c.calibratedProb != null);

  // Step 73: edge × horizon heatmap (avg P&L per cell)
  const edgeHorizonHeatmap: BacktestReport['edgeHorizonHeatmap'] = [];
  for (const eb of EDGE_BUCKETS) {
    for (const hb of HORIZON_BUCKETS) {
      const inCell = records.filter(r =>
        r.rawEdge != null && Math.abs(r.rawEdge) >= eb.min && Math.abs(r.rawEdge) < eb.max &&
        r.leadTimeHours != null && r.leadTimeHours >= hb.minHours && r.leadTimeHours < hb.maxHours &&
        r.pnlCents != null,
      );
      const avg = inCell.length > 0
        ? Math.round(inCell.reduce((s, r) => s + (r.pnlCents as number), 0) / inCell.length)
        : null;
      edgeHorizonHeatmap.push({
        edgeBucket: eb.label,
        horizonBucket: hb.label,
        avgPnlCents: avg,
        sample: inCell.length,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    filters,
    summary: {
      recordsAnalyzed: records.length,
      resolvedRecords: records.filter(r => r.resolved).length,
      rawStrategyPnlCents: raw.totalPnlCents,
      calibratedStrategyPnlCents: calibrated.totalPnlCents,
      rawWinRatePct: raw.winRatePct,
      calibratedWinRatePct: calibrated.winRatePct,
      brierImprovement,
      signalsDowngraded: downgraded.length,
      signalsDowngradedPct: records.length > 0 ? Math.round((downgraded.length / records.length) * 1000) / 10 : 0,
      correctDowngrades,
      falseDowngrades,
      correctDowngradesPct: downgradedWithPnl.length > 0 ? Math.round((correctDowngrades / downgradedWithPnl.length) * 1000) / 10 : null,
      falseDowngradesPct: downgradedWithPnl.length > 0 ? Math.round((falseDowngrades / downgradedWithPnl.length) * 1000) / 10 : null,
      recommendationCount: recommendations.length,
      overallEvidence: raw.evidence,
      overallEvidenceLabel: raw.evidenceLabel,
    },
    rawVsCalibrated: { raw, calibrated },
    reliabilityBuckets: buckets,
    componentDiagnostics: diagnostics,
    recommendations,
    severityCounts,
    recentCandlesticks,
    edgeHorizonHeatmap,
    methodology: [
      'Records are loaded from kalshi:demo:orders + kalshi:live:orders (filterable by mode, date range, source, metric, location).',
      'For each record we recompute reliabilityFactor against the current calibration history (7-day → 30-day → all-time fallback, ≥30 samples per bucket).',
      'Raw strategy: every settled record contributes to win/loss/P&L. Brier uses the model probability stored on the candidate.',
      'Calibrated strategy: records where reliabilityFactor < RELIABILITY_CAP_NO_TRADE (0.25) are excluded — simulating that Step 71 would have forced no-trade. Brier uses the shrunk probability (model prob pulled toward 0.5 by 1 - reliabilityFactor).',
      'Top-decile / top-quartile P&L are computed by sorting records by their respective edge (rawEdge for raw, calibratedEdge for calibrated) and averaging P&L over the top slice.',
      'A downgrade is considered "correct" if the record had non-positive P&L. "False" if the record had positive P&L and beat the overall average P&L.',
      'Component diagnostics expose each factor (probability / edge / horizon) and their Pearson correlation with outcome and P&L. Venue is a stub — see warning.',
      `Evidence labels: <30 = ${evidenceLabel('insufficient')}; 30–99 = ${evidenceLabel('early')}; 100–199 = ${evidenceLabel('moderate')}; 200+ = ${evidenceLabel('stronger')}. Nothing is ever labeled "proven."`,
      'No autonomous trading, no automatic filtering, no execution changes, no risk-limit changes, no automatic model promotion, no automatic threshold changes. All recommendations have autoApplied: false.',
    ],
  };
}
