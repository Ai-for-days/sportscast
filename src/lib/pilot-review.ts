// ── Step 85: Pilot performance attribution + go/no-go review ────────────────
//
// Formal review layer for pilots. Builds a draft analysis from linked +
// inferred records (Steps 80, 83, 84) and recommends continue / pause /
// expand / stop / needs_more_data. Read-only — no autonomous trading, no
// order submission, no execution candidate creation, no pilot state
// auto-change, no strategy auto-promotion.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getPilot, computePilotMonitoring, loadLinkedRecords, type PilotPlan, type PilotMonitoring } from './strategy-pilot';
import { listPaperRecords } from './paper-strategy-portfolio';

const KEY_PREFIX = 'pilot-review:';
const SET_KEY = 'pilot-reviews:all';
const MAX_REVIEWS = 1000;

// ── Types ───────────────────────────────────────────────────────────────────

export type ReviewType = 'daily' | 'weekly' | 'end_of_pilot' | 'ad_hoc';
export type ReviewStatus = 'draft' | 'completed';
export type Recommendation = 'continue' | 'pause' | 'expand' | 'stop' | 'needs_more_data';
export type Confidence = 'low' | 'medium' | 'high';

export const REVIEW_TYPES: ReviewType[] = ['daily', 'weekly', 'end_of_pilot', 'ad_hoc'];
export const RECOMMENDATIONS: Recommendation[] = ['continue', 'pause', 'expand', 'stop', 'needs_more_data'];
export const CONFIDENCES: Confidence[] = ['low', 'medium', 'high'];

export interface PilotReview {
  id: string;
  createdAt: string;
  updatedAt: string;
  pilotId: string;
  pilotName: string;
  strategyId: string;
  reviewType: ReviewType;
  status: ReviewStatus;
  reviewer: string;
  recommendation: Recommendation;
  confidence: Confidence;
  metricsSnapshot: PilotMonitoring;
  attribution: AttributionAnalysis;
  warnings: string[];
  reasons: string[];
  followUpActions: string[];
  notes?: string;
  completedAt?: string;
  completedBy?: string;
}

export interface AttributionAnalysis {
  performance: {
    totalLinkedRecords: number;
    linkedCandidates: number;
    linkedDemoOrders: number;
    linkedLiveOrders: number;
    linkedPaperRecords: number;
    linkedSettlements: number;
    totalPnlCents: number;
    roiPct: number | null;
    winRatePct: number | null;
    avgPnlCents: number | null;
    bestPnlCents: number | null;
    worstPnlCents: number | null;
    maxDrawdownCents: number;
    currentDrawdownCents: number;
  };
  execution: {
    plannedStakeCents: number;       // sum of cappedStake on paper records
    actualStakeCents: number;        // sum of costBasis on linked orders
    plannedVsActualGapCents: number;
    paperWithoutOrders: number;       // paper records that should have a matched order
    ordersWithoutPaper: number;       // linked orders that have no matching paper record
    avgSlippageCents: number | null;  // |submittedPrice − fillPrice| × qty avg, when fields exist
    slippageSampleSize: number;
    settlementLagDays: number | null; // avg days between order createdAt and settlement
    settlementLagSampleSize: number;
  };
  risk: {
    exposureBySource: { key: string; cents: number; pct: number }[];
    exposureByMetric: { key: string; cents: number; pct: number }[];
    exposureByDate: { key: string; cents: number; pct: number }[];
    exposureByLocation: { key: string; cents: number; pct: number }[];
    concentrationWarnings: string[];
    limitBreaches: string[];
  };
  quality: {
    byReliabilityBucket: BucketRow[];
    byEdgeBucket: BucketRow[];
    eligibilityFailReasons: string[];
    venueAdjustedCount: number;
  };
}

interface BucketRow {
  bucket: string;
  count: number;
  settled: number;
  wins: number;
  hitRatePct: number | null;
  totalPnlCents: number;
}

const RELIABILITY_BUCKETS = [
  { label: '0.00–0.25', min: 0.00, max: 0.25 },
  { label: '0.25–0.40', min: 0.25, max: 0.40 },
  { label: '0.40–0.60', min: 0.40, max: 0.60 },
  { label: '0.60–0.85', min: 0.60, max: 0.85 },
  { label: '0.85–1.00', min: 0.85, max: 1.0001 },
];
const EDGE_BUCKETS_PCT = [
  { label: '<2%',    min: 0.000, max: 0.020 },
  { label: '2–5%',   min: 0.020, max: 0.050 },
  { label: '5–10%',  min: 0.050, max: 0.100 },
  { label: '10–15%', min: 0.100, max: 0.150 },
  { label: '15–25%', min: 0.150, max: 0.250 },
  { label: '>25%',   min: 0.250, max: Infinity },
];

function newId(): string {
  return `prv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Attribution computation ─────────────────────────────────────────────────

function computeBucketStats(label: string, records: any[]): BucketRow {
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
  };
}

function pctSplit(map: Record<string, number>, total: number): { key: string; cents: number; pct: number }[] {
  return Object.entries(map)
    .map(([key, cents]) => ({ key, cents, pct: total > 0 ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

async function computeAttribution(pilot: PilotPlan, monitoring: PilotMonitoring): Promise<AttributionAnalysis> {
  const linked = await loadLinkedRecords(pilot.id);
  const allPaper = await listPaperRecords(2000);

  // Performance
  const allRecords = [...linked.paperRecords, ...allPaper.filter(p => !linked.paperRecords.some(lp => lp.id === p.id) && (p.pilotId === pilot.id))];
  const settled = allRecords.filter(r => r.status === 'settled' && r.pnlCents != null);
  const wins = settled.filter(r => (r.pnlCents as number) > 0).length;
  const totalPnl = settled.reduce((s, r) => s + (r.pnlCents as number), 0);
  const totalStake = settled.reduce((s, r) => s + (r.cappedStakeCents ?? 0), 0);
  const allPnls = settled.map(r => r.pnlCents as number);

  // Execution attribution
  const plannedStakeCents = linked.paperRecords.reduce((s: number, r: any) => s + (r.cappedStakeCents ?? 0), 0);
  const actualOrdersStake = [...linked.demoOrders, ...linked.liveOrders].reduce((s: number, o: any) =>
    s + (o.costBasisCents ?? o.maxNotionalCents ?? 0), 0);

  // Match orders ↔ paper by ticker (loose; paper.signalId starts with ks_ for kalshi)
  const orderTickers = new Set([...linked.demoOrders, ...linked.liveOrders].map((o: any) => o.ticker).filter(Boolean));
  const paperTickers = new Set(linked.paperRecords.map((r: any) => (r.signalId ?? '').replace(/^ks_/, '')).filter(Boolean));
  const paperWithoutOrders = linked.paperRecords.filter((r: any) => {
    const t = (r.signalId ?? '').replace(/^ks_/, '');
    return t && !orderTickers.has(t) && r.status === 'settled';
  }).length;
  const ordersWithoutPaper = [...linked.demoOrders, ...linked.liveOrders].filter((o: any) =>
    o.ticker && !paperTickers.has(o.ticker)).length;

  // Slippage (when both submittedPriceCents and fillPriceCents exist)
  const slippages: number[] = [];
  for (const o of [...linked.demoOrders, ...linked.liveOrders]) {
    if (o.submittedPriceCents != null && o.fillPriceCents != null) {
      slippages.push(Math.abs(o.fillPriceCents - o.submittedPriceCents) * (o.quantity ?? 1));
    }
  }
  const avgSlippageCents = slippages.length > 0
    ? Math.round(slippages.reduce((s, v) => s + v, 0) / slippages.length)
    : null;

  // Settlement lag (avg days between order createdAt and settlement)
  const settlementLags: number[] = [];
  const orderById = new Map<string, any>();
  for (const o of [...linked.demoOrders, ...linked.liveOrders]) orderById.set(o.id, o);
  for (const s of linked.settlements) {
    const order = orderById.get(s.orderId);
    if (!order) continue;
    const oTs = new Date(order.createdAt).getTime();
    const sTs = new Date(s.settledAt ?? s.resolvedAt ?? s.createdAt ?? Date.now()).getTime();
    if (Number.isFinite(oTs) && Number.isFinite(sTs) && sTs >= oTs) {
      settlementLags.push((sTs - oTs) / (24 * 3600 * 1000));
    }
  }
  const avgSettlementLagDays = settlementLags.length > 0
    ? Math.round((settlementLags.reduce((s, v) => s + v, 0) / settlementLags.length) * 10) / 10
    : null;

  // Risk: exposure buckets across linked paper records (most reliable signal)
  const exposureSrc: Record<string, number> = {};
  const exposureMetric: Record<string, number> = {};
  const exposureDate: Record<string, number> = {};
  const exposureLoc: Record<string, number> = {};
  for (const r of linked.paperRecords) {
    const stake = r.cappedStakeCents ?? 0;
    if (r.source) exposureSrc[r.source] = (exposureSrc[r.source] ?? 0) + stake;
    if (r.metric) exposureMetric[r.metric] = (exposureMetric[r.metric] ?? 0) + stake;
    if (r.targetDate) exposureDate[r.targetDate] = (exposureDate[r.targetDate] ?? 0) + stake;
    if (r.locationName) exposureLoc[r.locationName] = (exposureLoc[r.locationName] ?? 0) + stake;
  }
  const totalExposure = linked.paperRecords.reduce((s: number, r: any) => s + (r.cappedStakeCents ?? 0), 0);

  const concentrationWarnings: string[] = [];
  for (const [key, cents] of Object.entries(exposureLoc)) {
    if (totalExposure > 0 && cents / totalExposure > 0.40) {
      concentrationWarnings.push(`Location "${key}": ${(cents / totalExposure * 100).toFixed(0)}% of allocated exposure`);
    }
  }
  for (const [key, cents] of Object.entries(exposureDate)) {
    if (totalExposure > 0 && cents / totalExposure > 0.40) {
      concentrationWarnings.push(`Date "${key}": ${(cents / totalExposure * 100).toFixed(0)}% of allocated exposure`);
    }
  }

  // Quality buckets
  const byReliabilityBucket = RELIABILITY_BUCKETS.map(b => {
    const inBucket = linked.paperRecords.filter((r: any) =>
      r.reliabilityFactor != null && r.reliabilityFactor >= b.min && r.reliabilityFactor < b.max);
    return computeBucketStats(b.label, inBucket);
  });
  const byEdgeBucket = EDGE_BUCKETS_PCT.map(b => {
    const inBucket = linked.paperRecords.filter((r: any) =>
      r.calibratedEdge != null && r.calibratedEdge >= b.min && r.calibratedEdge < b.max);
    return computeBucketStats(b.label, inBucket);
  });

  const venueAdjustedCount = 0; // venueAdjustment is applied at signal-ranking time and not persisted on paper records

  return {
    performance: {
      totalLinkedRecords: linked.candidates.length + linked.demoOrders.length + linked.liveOrders.length + linked.paperRecords.length,
      linkedCandidates: linked.candidates.length,
      linkedDemoOrders: linked.demoOrders.length,
      linkedLiveOrders: linked.liveOrders.length,
      linkedPaperRecords: linked.paperRecords.length,
      linkedSettlements: linked.settlements.length,
      totalPnlCents: totalPnl,
      roiPct: totalStake > 0 ? Math.round((totalPnl / totalStake) * 1000) / 10 : null,
      winRatePct: settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : null,
      avgPnlCents: settled.length > 0 ? Math.round(totalPnl / settled.length) : null,
      bestPnlCents: allPnls.length > 0 ? Math.max(...allPnls) : null,
      worstPnlCents: allPnls.length > 0 ? Math.min(...allPnls) : null,
      maxDrawdownCents: monitoring.maxDrawdownCents,
      currentDrawdownCents: monitoring.currentDrawdownCents,
    },
    execution: {
      plannedStakeCents,
      actualStakeCents: actualOrdersStake,
      plannedVsActualGapCents: plannedStakeCents - actualOrdersStake,
      paperWithoutOrders,
      ordersWithoutPaper,
      avgSlippageCents,
      slippageSampleSize: slippages.length,
      settlementLagDays: avgSettlementLagDays,
      settlementLagSampleSize: settlementLags.length,
    },
    risk: {
      exposureBySource:   pctSplit(exposureSrc, totalExposure).map(b => ({ key: b.key, cents: b.cents, pct: b.pct })),
      exposureByMetric:   pctSplit(exposureMetric, totalExposure).map(b => ({ key: b.key, cents: b.cents, pct: b.pct })),
      exposureByDate:     pctSplit(exposureDate, totalExposure).map(b => ({ key: b.key, cents: b.cents, pct: b.pct })),
      exposureByLocation: pctSplit(exposureLoc, totalExposure).map(b => ({ key: b.key, cents: b.cents, pct: b.pct })),
      concentrationWarnings,
      limitBreaches: monitoring.breaches,
    },
    quality: {
      byReliabilityBucket,
      byEdgeBucket,
      eligibilityFailReasons: [], // placeholder — could pull from a future Step
      venueAdjustedCount,
    },
  };
}

// ── Go/no-go rules ──────────────────────────────────────────────────────────

interface DecisionInput {
  pilot: PilotPlan;
  monitoring: PilotMonitoring;
  attribution: AttributionAnalysis;
}

interface DecisionResult {
  recommendation: Recommendation;
  confidence: Confidence;
  reasons: string[];
  warnings: string[];
  followUpActions: string[];
}

function classifyConfidence(settled: number): Confidence {
  if (settled >= 100) return 'high';
  if (settled >= 30) return 'medium';
  return 'low';
}

function decide(input: DecisionInput): DecisionResult {
  const { monitoring, attribution } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const followUpActions: string[] = [];

  const settled = attribution.performance.linkedPaperRecords > 0
    ? attribution.performance.linkedPaperRecords
    : monitoring.settledPositions;
  const roi = attribution.performance.roiPct;
  const ddCents = attribution.performance.maxDrawdownCents;
  const breaches = monitoring.breaches;
  const concentrationCount = attribution.risk.concentrationWarnings.length;
  const ordersWithoutPaper = attribution.execution.ordersWithoutPaper;

  // Compose warnings
  if (breaches.length > 0) warnings.push(`${breaches.length} active limit breach(es)`);
  if (concentrationCount > 0) warnings.push(`${concentrationCount} concentration warning(s)`);
  if (ordersWithoutPaper > 0) warnings.push(`${ordersWithoutPaper} order(s) without matching paper allocation — attribution gap`);
  if (attribution.execution.slippageSampleSize === 0 && attribution.performance.linkedLiveOrders > 0) {
    warnings.push('Slippage data unavailable on live orders — fill price not recorded');
  }

  // Recommendation
  let recommendation: Recommendation;
  if (settled < 5) {
    recommendation = 'needs_more_data';
    reasons.push(`Only ${settled} settled record(s) attributed to this pilot`);
    followUpActions.push('Continue running paper / demo trades and link them via Execution Review');
  } else if (breaches.length > 0) {
    recommendation = 'pause';
    reasons.push(`Limit breach: ${breaches.join('; ')}`);
    followUpActions.push('Pause the pilot, investigate the breach, then either resume with adjusted limits or stop.');
  } else if (input.pilot.maxCapitalCents > 0 && ddCents > 0.4 * input.pilot.maxCapitalCents) {
    recommendation = 'stop';
    reasons.push(`Drawdown ${(ddCents / 100).toFixed(2)}$ exceeds 40% of pilot max-capital`);
    followUpActions.push('Stop pilot; surface to operator review for an end-of-pilot writeup.');
  } else if (input.pilot.maxCapitalCents > 0 && ddCents > 0.2 * input.pilot.maxCapitalCents) {
    recommendation = 'pause';
    reasons.push(`Drawdown ${(ddCents / 100).toFixed(2)}$ exceeds 20% of pilot max-capital`);
    followUpActions.push('Pause and review: is the model degrading or is this normal variance?');
  } else if (settled >= 100 && roi != null && roi > 0 && ddCents <= 0.15 * Math.max(1, input.pilot.maxCapitalCents) && breaches.length === 0 && concentrationCount === 0) {
    recommendation = 'expand';
    reasons.push(`${settled} settled records, ROI ${roi.toFixed(1)}%, drawdown contained, no warnings`);
    followUpActions.push('Consider widening max-capital or adding allowed sources/metrics. Approve via the registry workflow.');
  } else if (settled >= 30 && roi != null && roi < -2) {
    recommendation = 'stop';
    reasons.push(`${settled} settled records with negative ROI ${roi.toFixed(1)}%`);
    followUpActions.push('Stop the pilot; route the strategy back to research for re-tuning.');
  } else if (roi != null && roi >= 0) {
    recommendation = 'continue';
    reasons.push(`${settled} settled records, ROI ${roi.toFixed(1)}%, no critical breaches`);
    followUpActions.push('Continue monitoring. Re-review after the next 25 settled trades or weekly cadence.');
  } else {
    recommendation = 'continue';
    reasons.push(`${settled} settled records — performance still developing`);
    followUpActions.push('Continue monitoring. Re-review weekly until the sample exceeds 30.');
  }

  const confidence = classifyConfidence(settled);
  return { recommendation, confidence, reasons, warnings, followUpActions };
}

// ── Draft generation ────────────────────────────────────────────────────────

export interface DraftReview {
  pilot: PilotPlan;
  metricsSnapshot: PilotMonitoring;
  attribution: AttributionAnalysis;
  recommendation: Recommendation;
  confidence: Confidence;
  reasons: string[];
  warnings: string[];
  followUpActions: string[];
}

export async function generateDraftReview(pilotId: string): Promise<DraftReview> {
  const pilot = await getPilot(pilotId);
  if (!pilot) throw new Error(`Pilot ${pilotId} not found`);
  const monitoring = await computePilotMonitoring(pilot);
  const attribution = await computeAttribution(pilot, monitoring);
  const decision = decide({ pilot, monitoring, attribution });
  return {
    pilot,
    metricsSnapshot: monitoring,
    attribution,
    recommendation: decision.recommendation,
    confidence: decision.confidence,
    reasons: decision.reasons,
    warnings: decision.warnings,
    followUpActions: decision.followUpActions,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function listReviews(limit = 200): Promise<PilotReview[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_KEY);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_KEY, 0, Math.min(total, limit) - 1, { rev: true });
  const out: PilotReview[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function getReview(id: string): Promise<PilotReview | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PilotReview);
}

async function saveReview(review: PilotReview): Promise<void> {
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${review.id}`, JSON.stringify(review));
}

export async function createReview(input: {
  pilotId: string;
  reviewType: ReviewType;
  reviewer: string;
  notes?: string;
}): Promise<PilotReview> {
  const redis = getRedis();
  const draft = await generateDraftReview(input.pilotId);
  const now = new Date().toISOString();
  const review: PilotReview = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    pilotId: input.pilotId,
    pilotName: draft.pilot.strategyName,
    strategyId: draft.pilot.strategyId,
    reviewType: input.reviewType,
    status: 'draft',
    reviewer: input.reviewer,
    recommendation: draft.recommendation,
    confidence: draft.confidence,
    metricsSnapshot: draft.metricsSnapshot,
    attribution: draft.attribution,
    warnings: draft.warnings,
    reasons: draft.reasons,
    followUpActions: draft.followUpActions,
    notes: input.notes,
  };

  await redis.set(`${KEY_PREFIX}${review.id}`, JSON.stringify(review));
  await redis.zadd(SET_KEY, { score: Date.now(), member: review.id });
  await trimToCap(redis, SET_KEY, KEY_PREFIX, MAX_REVIEWS);

  await logAuditEvent({
    actor: input.reviewer,
    eventType: 'pilot_review_created',
    targetType: 'pilot',
    targetId: input.pilotId,
    summary: `Pilot review draft created (${input.reviewType}) — recommendation: ${draft.recommendation} / ${draft.confidence}`,
    details: { reviewId: review.id, recommendation: draft.recommendation, confidence: draft.confidence },
  });

  return review;
}

export async function completeReview(input: {
  id: string;
  reviewer: string;
  recommendation?: Recommendation;
  confidence?: Confidence;
  notes?: string;
  followUpActions?: string[];
}): Promise<PilotReview | null> {
  const existing = await getReview(input.id);
  if (!existing) return null;
  if (existing.status === 'completed') return existing;
  const now = new Date().toISOString();
  const updated: PilotReview = {
    ...existing,
    status: 'completed',
    completedAt: now,
    completedBy: input.reviewer,
    updatedAt: now,
    recommendation: input.recommendation ?? existing.recommendation,
    confidence: input.confidence ?? existing.confidence,
    notes: input.notes ?? existing.notes,
    followUpActions: input.followUpActions ?? existing.followUpActions,
  };
  await saveReview(updated);

  await logAuditEvent({
    actor: input.reviewer,
    eventType: 'pilot_review_completed',
    targetType: 'pilot',
    targetId: existing.pilotId,
    summary: `Pilot review ${existing.id} completed — final recommendation: ${updated.recommendation} / ${updated.confidence}`,
    details: { reviewId: existing.id, recommendation: updated.recommendation, confidence: updated.confidence },
  });

  return updated;
}

export async function addReviewNote(id: string, note: string, actor: string): Promise<PilotReview | null> {
  const existing = await getReview(id);
  if (!existing) return null;
  const stamped = `[${new Date().toISOString()}] ${actor}: ${note}`;
  const next: PilotReview = {
    ...existing,
    notes: existing.notes ? `${existing.notes}\n${stamped}` : stamped,
    updatedAt: new Date().toISOString(),
  };
  await saveReview(next);
  return next;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function trimToCap(redis: any, setKey: string, keyPrefix: string, cap: number) {
  const total = await redis.zcard(setKey);
  if (total <= cap) return;
  const overflow = total - cap;
  const oldest = await redis.zrange(setKey, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(setKey, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${keyPrefix}${oldId}`);
  }
}
