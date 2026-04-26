// ── Step 80: Paper strategy portfolio ───────────────────────────────────────
//
// Record which systematic-eligible signals WOULD have been taken under the
// Step 78 allocation engine and track their later performance. Manual
// capture only — no scheduled jobs, no live trading, no order submission.
//
// Storage: Redis. Each record at `paper-portfolio:{id}`; sorted-set
// chronological index at `paper-portfolio:all` (score = createdAt ms);
// per-signal dedup index at `paper-portfolio:idx:{signalId}:{targetDate}:{side}`
// holds the record id, so capture-current-allocation never inserts the
// same trade twice.

import { getRedis } from './redis';
import { buildAllocationReport, type AllocationRecord } from './portfolio-allocation';
import { getStrategyMode, type StrategyMode } from './strategy-mode';

const KEY_PREFIX = 'paper-portfolio:';
const SET_KEY = 'paper-portfolio:all';
const IDX_PREFIX = 'paper-portfolio:idx:';
const MAX_ENTRIES = 5000;

export type PaperStatus = 'open' | 'settled' | 'void';
export type PaperOutcome = 'win' | 'loss' | 'push';

export interface PaperPortfolioRecord {
  id: string;
  createdAt: string;
  strategyMode: StrategyMode;
  signalId: string;
  title: string;
  source: 'kalshi' | 'sportsbook';
  side?: 'yes' | 'no';
  marketType?: string;
  locationName?: string;
  metric?: string;
  targetDate?: string;
  calibratedEdge?: number;
  reliabilityFactor?: number;
  signalScore?: number;
  sizingTier?: string;
  recommendedStakeCents: number;
  cappedStakeCents: number;
  entryMarketProb?: number;
  entryModelProb?: number;
  entryCalibratedProb?: number;
  status: PaperStatus;
  outcome?: PaperOutcome;
  pnlCents?: number;
  settledAt?: string;
  notes?: string;
  // Step 84: optional pilot tagging — backward compatible
  pilotId?: string;
  pilotName?: string;
  strategyId?: string;
  strategyName?: string;
}

function newId(): string {
  return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function dedupKey(signalId: string, targetDate: string | undefined, side: string | undefined): string {
  return `${IDX_PREFIX}${signalId}:${targetDate ?? '_'}:${side ?? '_'}`;
}

// Calibrated probability shrinks the model toward 0.5 by (1 - reliabilityFactor).
function shrunkProb(modelProb: number | undefined, reliability: number | undefined): number | undefined {
  if (modelProb == null || reliability == null) return undefined;
  return 0.5 + (modelProb - 0.5) * reliability;
}

// ── Capture ─────────────────────────────────────────────────────────────────

export interface CaptureResult {
  capturedCount: number;
  duplicateCount: number;
  skippedZeroStake: number;
  totalEligible: number;
  records: PaperPortfolioRecord[];
}

export async function captureCurrentAllocation(): Promise<CaptureResult> {
  const redis = getRedis();
  const allocation = await buildAllocationReport();
  const mode = allocation.strategyMode;

  const eligibleAllocated = allocation.records.filter(r => r.systematicEligible && r.cappedStakeCents > 0);
  const skippedZeroStake = allocation.records.filter(r => r.systematicEligible && r.cappedStakeCents === 0).length;

  const captured: PaperPortfolioRecord[] = [];
  let duplicates = 0;

  for (const r of eligibleAllocated) {
    const key = dedupKey(r.signalId, r.targetDate, r.side);
    const existing = await redis.get(key);
    if (existing) {
      duplicates++;
      continue;
    }

    const id = newId();
    const record = buildRecordFromAllocation(id, r, mode);
    await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(record));
    await redis.zadd(SET_KEY, { score: Date.now(), member: id });
    await redis.set(key, id);
    captured.push(record);
  }

  // Auto-trim oldest beyond MAX_ENTRIES (do not touch dedup index — trimmed
  // entries are old enough that re-capture is acceptable)
  const total = await redis.zcard(SET_KEY);
  if (total > MAX_ENTRIES) {
    const overflow = total - MAX_ENTRIES;
    const oldest = await redis.zrange(SET_KEY, 0, overflow - 1);
    if (oldest && oldest.length > 0) {
      await redis.zremrangebyrank(SET_KEY, 0, overflow - 1);
      for (const oldId of oldest) await redis.del(`${KEY_PREFIX}${oldId}`);
    }
  }

  return {
    capturedCount: captured.length,
    duplicateCount: duplicates,
    skippedZeroStake,
    totalEligible: eligibleAllocated.length + skippedZeroStake,
    records: captured,
  };
}

function buildRecordFromAllocation(id: string, r: AllocationRecord, mode: StrategyMode): PaperPortfolioRecord {
  return {
    id,
    createdAt: new Date().toISOString(),
    strategyMode: mode,
    signalId: r.signalId,
    title: r.title,
    source: r.source,
    side: r.side,
    locationName: r.locationName,
    metric: r.metric,
    targetDate: r.targetDate,
    calibratedEdge: r.calibratedEdge,
    reliabilityFactor: r.reliabilityFactor,
    signalScore: undefined, // not on AllocationRecord but available via signal — left undefined intentionally
    sizingTier: undefined,
    recommendedStakeCents: r.rawRecommendedStakeCents,
    cappedStakeCents: r.cappedStakeCents,
    entryMarketProb: r.marketProbForSide,
    entryModelProb: r.modelProbForSide,
    entryCalibratedProb: shrunkProb(r.modelProbForSide, r.reliabilityFactor),
    status: 'open',
  };
}

// ── List / get / patch ──────────────────────────────────────────────────────

export async function listPaperRecords(limit = 500): Promise<PaperPortfolioRecord[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_KEY);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_KEY, 0, Math.min(total, limit) - 1, { rev: true });
  const out: PaperPortfolioRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getPaperRecord(id: string): Promise<PaperPortfolioRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PaperPortfolioRecord);
}

async function savePaperRecord(rec: PaperPortfolioRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${rec.id}`, JSON.stringify(rec));
}

export async function voidPaperEntry(id: string, note?: string): Promise<PaperPortfolioRecord | null> {
  const r = await getPaperRecord(id);
  if (!r) return null;
  r.status = 'void';
  r.settledAt = new Date().toISOString();
  if (note) r.notes = note;
  await savePaperRecord(r);
  return r;
}

export async function addNote(id: string, note: string): Promise<PaperPortfolioRecord | null> {
  const r = await getPaperRecord(id);
  if (!r) return null;
  r.notes = note;
  await savePaperRecord(r);
  return r;
}

// ── Refresh outcomes ────────────────────────────────────────────────────────
//
// Walk all open paper entries; look for resolved orders + settlements that
// match by ticker (and were placed after the paper entry was captured); when
// a settlement with finalized P&L is found, mark the paper entry as settled
// with that outcome.

export interface RefreshResult {
  scanned: number;
  updated: number;
  stillOpen: number;
  noMatch: number;
}

export async function refreshPaperOutcomes(): Promise<RefreshResult> {
  const redis = getRedis();
  const all = await listPaperRecords(2000);
  const open = all.filter(r => r.status === 'open');
  if (open.length === 0) return { scanned: 0, updated: 0, stillOpen: 0, noMatch: 0 };

  // Index settlements by orderId
  const settCount = await redis.zcard('settlements:all');
  const settIds = settCount > 0 ? await redis.zrange('settlements:all', 0, Math.min(settCount, 1000) - 1, { rev: true }) : [];
  const settByOrder = new Map<string, any>();
  for (const id of settIds) {
    const raw = await redis.get(`settlement:${id}`);
    if (raw) {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (s.orderId) settByOrder.set(s.orderId, s);
    }
  }

  // Index orders by ticker for fast lookup
  const ordersByTicker = new Map<string, any[]>();
  for (const set of ['kalshi:demo:orders', 'kalshi:live:orders']) {
    const cnt = await redis.zcard(set);
    if (cnt === 0) continue;
    const ids = await redis.zrange(set, 0, Math.min(cnt, 1000) - 1, { rev: true });
    const prefix = set.includes('demo') ? 'kalshi:demo:order:' : 'kalshi:live:order:';
    for (const id of ids) {
      const raw = await redis.get(`${prefix}${id}`);
      if (!raw) continue;
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const t = o.ticker as string | undefined;
      if (!t) continue;
      if (!ordersByTicker.has(t)) ordersByTicker.set(t, []);
      ordersByTicker.get(t)!.push(o);
    }
  }

  let updated = 0;
  let noMatch = 0;
  for (const r of open) {
    // Underlying ticker — strip the `ks_` prefix the signal id used.
    const ticker = r.signalId.replace(/^ks_/, '');
    const candidates = ordersByTicker.get(ticker) ?? [];

    // Filter to orders placed at or after paper-entry creation, on the same
    // side, with a finalized settlement.
    const created = new Date(r.createdAt).getTime();
    const matchedSettlement = candidates
      .filter(o => {
        const ts = (o.timestamp ?? o.createdAt) as number | undefined;
        return ts != null && ts >= created;
      })
      .filter(o => !r.side || o.side === r.side)
      .map(o => settByOrder.get(o.id))
      .find(s => s && s.netPnlCents != null);

    if (!matchedSettlement) {
      noMatch++;
      continue;
    }

    const pnlCents: number = matchedSettlement.netPnlCents;
    const outcome: PaperOutcome = pnlCents > 0 ? 'win' : pnlCents < 0 ? 'loss' : 'push';
    r.status = 'settled';
    r.outcome = outcome;
    r.pnlCents = pnlCents;
    r.settledAt = new Date().toISOString();
    await savePaperRecord(r);
    updated++;
  }

  return {
    scanned: open.length,
    updated,
    stillOpen: open.length - updated,
    noMatch,
  };
}

// ── Performance metrics ─────────────────────────────────────────────────────

const RELIABILITY_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0.00–0.25', min: 0.00, max: 0.25 },
  { label: '0.25–0.40', min: 0.25, max: 0.40 },
  { label: '0.40–0.60', min: 0.40, max: 0.60 },
  { label: '0.60–0.85', min: 0.60, max: 0.85 },
  { label: '0.85–1.00', min: 0.85, max: 1.0001 },
];

const HORIZON_BUCKETS: { label: string; minH: number; maxH: number }[] = [
  { label: '0–12h',  minH: 0,   maxH: 12 },
  { label: '12–24h', minH: 12,  maxH: 24 },
  { label: '1–3d',   minH: 24,  maxH: 72 },
  { label: '3–7d',   minH: 72,  maxH: 168 },
  { label: '7–15d',  minH: 168, maxH: 360 },
];

interface BucketStat {
  bucket: string;
  count: number;
  settled: number;
  wins: number;
  hitRatePct: number | null;
  totalPnlCents: number;
  avgPnlCents: number | null;
}

function bucketStats(label: string, records: PaperPortfolioRecord[]): BucketStat {
  const settled = records.filter(r => r.status === 'settled' && r.pnlCents != null);
  const wins = settled.filter(r => (r.pnlCents as number) > 0).length;
  const total = settled.reduce((s, r) => s + (r.pnlCents as number), 0);
  return {
    bucket: label,
    count: records.length,
    settled: settled.length,
    wins,
    hitRatePct: settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : null,
    totalPnlCents: total,
    avgPnlCents: settled.length > 0 ? Math.round(total / settled.length) : null,
  };
}

function leadHours(createdAt: string, targetDate: string | undefined): number | null {
  if (!targetDate) return null;
  const t = new Date(`${targetDate}T12:00:00Z`).getTime();
  const c = new Date(createdAt).getTime();
  if (Number.isNaN(t) || Number.isNaN(c)) return null;
  return Math.max(0, (t - c) / 3_600_000);
}

export interface PaperPerformance {
  totals: {
    captured: number;
    open: number;
    settled: number;
    voided: number;
  };
  settled: {
    wins: number;
    losses: number;
    pushes: number;
    winRatePct: number | null;
    totalPnlCents: number;
    avgPnlCents: number | null;
    totalStakeCents: number;
    roiPct: number | null;
    bestPnlCents: number | null;
    worstPnlCents: number | null;
  };
  exposure: {
    openExposureCents: number;
    settledExposureCents: number;
  };
  drawdown: {
    maxDrawdownCents: number;
    cumulativePnl: { id: string; ts: number; cumulativePnlCents: number; pnlCents: number; title: string }[];
  };
  bySource: BucketStat[];
  byMetric: BucketStat[];
  byHorizon: BucketStat[];
  byReliability: BucketStat[];
}

export function computePerformance(records: PaperPortfolioRecord[]): PaperPerformance {
  const open = records.filter(r => r.status === 'open');
  const settled = records.filter(r => r.status === 'settled' && r.pnlCents != null);
  const voided = records.filter(r => r.status === 'void');

  const wins = settled.filter(r => (r.pnlCents as number) > 0).length;
  const losses = settled.filter(r => (r.pnlCents as number) < 0).length;
  const pushes = settled.filter(r => (r.pnlCents as number) === 0).length;
  const totalPnl = settled.reduce((s, r) => s + (r.pnlCents as number), 0);
  const totalStake = settled.reduce((s, r) => s + r.cappedStakeCents, 0);

  // Cumulative PnL (chronological by settledAt)
  const settledChrono = [...settled].sort((a, b) =>
    new Date(a.settledAt ?? a.createdAt).getTime() - new Date(b.settledAt ?? b.createdAt).getTime()
  );
  let cum = 0;
  let runningMax = 0;
  let maxDD = 0;
  const curve = settledChrono.map(r => {
    cum += r.pnlCents as number;
    if (cum > runningMax) runningMax = cum;
    const dd = runningMax - cum;
    if (dd > maxDD) maxDD = dd;
    return {
      id: r.id,
      ts: new Date(r.settledAt ?? r.createdAt).getTime(),
      cumulativePnlCents: cum,
      pnlCents: r.pnlCents as number,
      title: r.title,
    };
  });

  // Buckets
  const bySource: BucketStat[] = [
    bucketStats('kalshi',     records.filter(r => r.source === 'kalshi')),
    bucketStats('sportsbook', records.filter(r => r.source === 'sportsbook')),
  ];

  const metricSet = new Set<string>();
  for (const r of records) if (r.metric) metricSet.add(r.metric);
  const byMetric: BucketStat[] = Array.from(metricSet)
    .map(m => bucketStats(m, records.filter(r => r.metric === m)))
    .sort((a, b) => b.count - a.count);

  const byHorizon: BucketStat[] = HORIZON_BUCKETS.map(b => {
    const inBucket = records.filter(r => {
      const h = leadHours(r.createdAt, r.targetDate);
      return h != null && h >= b.minH && h < b.maxH;
    });
    return bucketStats(b.label, inBucket);
  });

  const byReliability: BucketStat[] = RELIABILITY_BUCKETS.map(b => {
    const inBucket = records.filter(r =>
      r.reliabilityFactor != null && r.reliabilityFactor >= b.min && r.reliabilityFactor < b.max
    );
    return bucketStats(b.label, inBucket);
  });

  return {
    totals: {
      captured: records.length,
      open: open.length,
      settled: settled.length,
      voided: voided.length,
    },
    settled: {
      wins, losses, pushes,
      winRatePct: settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : null,
      totalPnlCents: totalPnl,
      avgPnlCents: settled.length > 0 ? Math.round(totalPnl / settled.length) : null,
      totalStakeCents: totalStake,
      roiPct: totalStake > 0 ? Math.round((totalPnl / totalStake) * 1000) / 10 : null,
      bestPnlCents: settled.length > 0 ? Math.max(...settled.map(r => r.pnlCents as number)) : null,
      worstPnlCents: settled.length > 0 ? Math.min(...settled.map(r => r.pnlCents as number)) : null,
    },
    exposure: {
      openExposureCents: open.reduce((s, r) => s + r.cappedStakeCents, 0),
      settledExposureCents: totalStake,
    },
    drawdown: {
      maxDrawdownCents: Math.round(maxDD),
      cumulativePnl: curve,
    },
    bySource,
    byMetric,
    byHorizon,
    byReliability,
  };
}
