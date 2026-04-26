// ── Step 82: Strategy registry + promotion workflow ────────────────────────
//
// Formal strategy lifecycle: draft → research → watchlist → paper_approved
// → pilot_ready, plus paused / retired. Every transition is manual and
// audit-logged. Promotions to paper_approved or pilot_ready require a
// promotion snapshot (captured from the Step 81 comparison output).
//
// CRITICAL CONSTRAINTS
//   - No autonomous trading
//   - No order submission
//   - No execution candidate creation
//   - No live execution changes
//   - No automatic promotion
//   - Governance + manual approval workflow only

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Storage keys ────────────────────────────────────────────────────────────

const KEY_STRAT_PREFIX = 'strategy:';
const SET_STRAT = 'strategies:all';
const KEY_PROMO_PREFIX = 'strategy:promo:';
const SET_PROMO = 'strategies:promotions:all';

const MAX_STRATEGIES = 200;
const MAX_PROMOTIONS = 1000;
const MAX_HISTORY_PER_STRATEGY = 50;

// ── Types ───────────────────────────────────────────────────────────────────

export type StrategyStatus =
  | 'draft' | 'research' | 'watchlist' | 'paper_approved'
  | 'pilot_ready' | 'paused' | 'retired';

export const STRATEGY_STATUSES: StrategyStatus[] = [
  'draft', 'research', 'watchlist', 'paper_approved', 'pilot_ready', 'paused', 'retired',
];

// Lifecycle: who can transition to what.
const ALLOWED_TRANSITIONS: Record<StrategyStatus, StrategyStatus[]> = {
  draft:          ['research', 'paused', 'retired'],
  research:       ['watchlist', 'paused', 'retired'],
  watchlist:      ['paper_approved', 'paused', 'retired', 'research'],
  paper_approved: ['pilot_ready', 'paused', 'retired', 'watchlist'],
  pilot_ready:   ['paused', 'retired', 'paper_approved'],
  paused:         ['research', 'watchlist', 'retired'],
  retired:        [],
};

// Statuses that require a fresh promotion snapshot to be entered.
export const STATUSES_REQUIRING_SNAPSHOT: StrategyStatus[] = ['paper_approved', 'pilot_ready'];

export interface StrategyFilters {
  minCalibratedEdge?: number;
  minReliability?: number;
  minSampleSize?: number;
  allowedSources?: string[];
  allowedMetrics?: string[];
  allowedHorizonBuckets?: string[];
  excludedVenueTypes?: string[];
}

export interface PromotionCriteria {
  minSettledTrades: number;
  minRoiPct: number;
  maxDrawdownPct: number;
  allowedStressVerdicts: string[];
  requireNoCriticalWarnings: boolean;
}

export const DEFAULT_PROMOTION_CRITERIA: PromotionCriteria = {
  minSettledTrades: 100,
  minRoiPct: 0,
  maxDrawdownPct: 25,
  allowedStressVerdicts: ['Healthy', 'Watch'],
  requireNoCriticalWarnings: true,
};

export interface StrategyHistoryEntry {
  at: string;
  actor: string;
  fromStatus: StrategyStatus;
  toStatus: StrategyStatus;
  reason?: string;
  promotionSnapshotId?: string;
}

export interface StrategyRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description: string;
  status: StrategyStatus;
  sourceVariantId?: string;
  filters: StrategyFilters;
  promotionCriteria: PromotionCriteria;
  latestMetrics?: any;
  latestVerdict?: string;
  notes?: string[];
  history?: StrategyHistoryEntry[];
}

export interface PromotionSnapshot {
  id: string;
  createdAt: string;
  strategyId: string;
  fromStatus: StrategyStatus;
  requestedStatus: StrategyStatus;
  variantId?: string;
  metricsSnapshot: any;
  readinessVerdict: string;
  reasons: string[];
  requestedBy: string;
  approvedBy?: string;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string;
  resolvedAt?: string;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Strategy CRUD ───────────────────────────────────────────────────────────

export async function createStrategy(input: {
  name: string;
  description?: string;
  sourceVariantId?: string;
  filters?: StrategyFilters;
  promotionCriteria?: Partial<PromotionCriteria>;
  initialStatus?: 'draft' | 'research';
  createdBy: string;
  latestMetrics?: any;
  latestVerdict?: string;
}): Promise<StrategyRecord> {
  const redis = getRedis();
  const now = new Date().toISOString();
  const id = newId('strat');
  const status: StrategyStatus = input.initialStatus ?? 'draft';

  const record: StrategyRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    name: input.name.trim() || `Strategy ${id}`,
    description: input.description ?? '',
    status,
    sourceVariantId: input.sourceVariantId,
    filters: input.filters ?? {},
    promotionCriteria: { ...DEFAULT_PROMOTION_CRITERIA, ...(input.promotionCriteria ?? {}) },
    latestMetrics: input.latestMetrics,
    latestVerdict: input.latestVerdict,
    notes: [],
    history: [{
      at: now,
      actor: input.createdBy,
      fromStatus: 'draft',
      toStatus: status,
      reason: 'created',
    }],
  };

  await redis.set(`${KEY_STRAT_PREFIX}${id}`, JSON.stringify(record));
  await redis.zadd(SET_STRAT, { score: Date.now(), member: id });
  await trimToCap(redis, SET_STRAT, KEY_STRAT_PREFIX, MAX_STRATEGIES);

  await logAuditEvent({
    actor: input.createdBy,
    eventType: 'strategy_created',
    targetType: 'strategy',
    targetId: id,
    summary: `Strategy "${record.name}" created in status ${status}`,
    details: { sourceVariantId: input.sourceVariantId, filters: record.filters },
  });

  return record;
}

export async function getStrategy(id: string): Promise<StrategyRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_STRAT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as StrategyRecord);
}

export async function saveStrategy(record: StrategyRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${KEY_STRAT_PREFIX}${record.id}`, JSON.stringify(record));
}

export async function listStrategies(limit = 100): Promise<StrategyRecord[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_STRAT);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_STRAT, 0, Math.min(total, limit) - 1, { rev: true });
  const out: StrategyRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_STRAT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function updateStrategy(id: string, patch: Partial<Pick<StrategyRecord, 'name' | 'description' | 'filters' | 'promotionCriteria' | 'latestMetrics' | 'latestVerdict'>>, actor: string): Promise<StrategyRecord | null> {
  const existing = await getStrategy(id);
  if (!existing) return null;
  const updated: StrategyRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await saveStrategy(updated);

  await logAuditEvent({
    actor,
    eventType: 'strategy_updated',
    targetType: 'strategy',
    targetId: id,
    summary: `Strategy "${updated.name}" metadata updated`,
    details: { patch: Object.keys(patch) },
  });
  return updated;
}

export async function addNote(id: string, note: string, actor: string): Promise<StrategyRecord | null> {
  const existing = await getStrategy(id);
  if (!existing) return null;
  existing.notes = [...(existing.notes ?? []), `[${new Date().toISOString()}] ${actor}: ${note}`];
  existing.updatedAt = new Date().toISOString();
  await saveStrategy(existing);
  return existing;
}

// ── Lifecycle transitions ──────────────────────────────────────────────────

export class TransitionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export async function transitionStatus(input: {
  strategyId: string;
  toStatus: StrategyStatus;
  actor: string;
  reason?: string;
  promotionSnapshotId?: string;
}): Promise<StrategyRecord> {
  const existing = await getStrategy(input.strategyId);
  if (!existing) throw new TransitionError('Strategy not found', 'not_found');

  const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(input.toStatus)) {
    throw new TransitionError(`Cannot move from ${existing.status} to ${input.toStatus}`, 'illegal_transition');
  }
  if (STATUSES_REQUIRING_SNAPSHOT.includes(input.toStatus) && !input.promotionSnapshotId) {
    throw new TransitionError(`Status ${input.toStatus} requires an approved promotion snapshot`, 'snapshot_required');
  }
  if (input.promotionSnapshotId) {
    const snap = await getPromotionSnapshot(input.promotionSnapshotId);
    if (!snap) throw new TransitionError('Promotion snapshot not found', 'snapshot_missing');
    if (snap.status !== 'approved') throw new TransitionError(`Snapshot ${snap.id} is ${snap.status}, must be approved`, 'snapshot_not_approved');
    if (snap.strategyId !== input.strategyId) throw new TransitionError('Snapshot belongs to a different strategy', 'snapshot_mismatch');
    if (snap.requestedStatus !== input.toStatus) throw new TransitionError(`Snapshot was approved for ${snap.requestedStatus}, not ${input.toStatus}`, 'snapshot_status_mismatch');
  }

  const now = new Date().toISOString();
  const entry: StrategyHistoryEntry = {
    at: now,
    actor: input.actor,
    fromStatus: existing.status,
    toStatus: input.toStatus,
    reason: input.reason,
    promotionSnapshotId: input.promotionSnapshotId,
  };
  const history = [...(existing.history ?? []), entry].slice(-MAX_HISTORY_PER_STRATEGY);
  const updated: StrategyRecord = { ...existing, status: input.toStatus, updatedAt: now, history };
  await saveStrategy(updated);

  await logAuditEvent({
    actor: input.actor,
    eventType: 'strategy_transitioned',
    targetType: 'strategy',
    targetId: input.strategyId,
    summary: `${existing.name}: ${existing.status} → ${input.toStatus}${input.reason ? ` (${input.reason})` : ''}`,
    details: { fromStatus: existing.status, toStatus: input.toStatus, snapshotId: input.promotionSnapshotId },
  });

  return updated;
}

// ── Promotion snapshots ────────────────────────────────────────────────────

export async function createPromotionSnapshot(input: {
  strategyId: string;
  requestedStatus: StrategyStatus;
  variantId?: string;
  metricsSnapshot: any;
  readinessVerdict: string;
  reasons: string[];
  requestedBy: string;
  notes?: string;
}): Promise<PromotionSnapshot> {
  const strategy = await getStrategy(input.strategyId);
  if (!strategy) throw new TransitionError('Strategy not found', 'not_found');
  if (!STATUSES_REQUIRING_SNAPSHOT.includes(input.requestedStatus)) {
    throw new TransitionError('Promotion snapshots are only required for paper_approved or pilot_ready', 'no_snapshot_needed');
  }
  const allowed = ALLOWED_TRANSITIONS[strategy.status] ?? [];
  if (!allowed.includes(input.requestedStatus)) {
    throw new TransitionError(`Cannot request promotion ${strategy.status} → ${input.requestedStatus}`, 'illegal_transition');
  }

  const redis = getRedis();
  const id = newId('promo');
  const snap: PromotionSnapshot = {
    id,
    createdAt: new Date().toISOString(),
    strategyId: input.strategyId,
    fromStatus: strategy.status,
    requestedStatus: input.requestedStatus,
    variantId: input.variantId,
    metricsSnapshot: input.metricsSnapshot,
    readinessVerdict: input.readinessVerdict,
    reasons: input.reasons,
    requestedBy: input.requestedBy,
    status: 'pending',
    notes: input.notes,
  };
  await redis.set(`${KEY_PROMO_PREFIX}${id}`, JSON.stringify(snap));
  await redis.zadd(SET_PROMO, { score: Date.now(), member: id });
  await trimToCap(redis, SET_PROMO, KEY_PROMO_PREFIX, MAX_PROMOTIONS);

  await logAuditEvent({
    actor: input.requestedBy,
    eventType: 'strategy_promotion_requested',
    targetType: 'strategy',
    targetId: input.strategyId,
    summary: `Promotion requested: ${strategy.status} → ${input.requestedStatus} (verdict: ${input.readinessVerdict})`,
    details: { snapshotId: id, variantId: input.variantId },
  });

  return snap;
}

export async function getPromotionSnapshot(id: string): Promise<PromotionSnapshot | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PROMO_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PromotionSnapshot);
}

export async function listPromotionSnapshots(limit = 100): Promise<PromotionSnapshot[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_PROMO);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_PROMO, 0, Math.min(total, limit) - 1, { rev: true });
  const out: PromotionSnapshot[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_PROMO_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function decidePromotion(input: {
  snapshotId: string;
  decision: 'approve' | 'reject';
  approver: string;
  notes?: string;
}): Promise<PromotionSnapshot> {
  const redis = getRedis();
  const snap = await getPromotionSnapshot(input.snapshotId);
  if (!snap) throw new TransitionError('Promotion snapshot not found', 'not_found');
  if (snap.status !== 'pending') throw new TransitionError(`Snapshot already ${snap.status}`, 'already_resolved');
  if (snap.requestedBy === input.approver) {
    // Step 82 spec: requester cannot self-approve. Rejecting your own request is fine.
    if (input.decision === 'approve') throw new TransitionError('Requester cannot self-approve a promotion', 'self_approval_blocked');
  }

  snap.status = input.decision === 'approve' ? 'approved' : 'rejected';
  snap.approvedBy = input.approver;
  snap.notes = input.notes ?? snap.notes;
  snap.resolvedAt = new Date().toISOString();
  await redis.set(`${KEY_PROMO_PREFIX}${snap.id}`, JSON.stringify(snap));

  await logAuditEvent({
    actor: input.approver,
    eventType: input.decision === 'approve' ? 'strategy_promotion_approved' : 'strategy_promotion_rejected',
    targetType: 'strategy',
    targetId: snap.strategyId,
    summary: `Promotion ${snap.id} ${input.decision}d by ${input.approver}`,
    details: { fromStatus: snap.fromStatus, requestedStatus: snap.requestedStatus, notes: input.notes },
  });

  return snap;
}

// ── Aggregates ──────────────────────────────────────────────────────────────

export interface StatusDistribution {
  status: StrategyStatus;
  count: number;
}

export function computeStatusDistribution(strategies: StrategyRecord[]): StatusDistribution[] {
  const counts = new Map<StrategyStatus, number>();
  for (const s of STRATEGY_STATUSES) counts.set(s, 0);
  for (const s of strategies) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
  return STRATEGY_STATUSES.map(status => ({ status, count: counts.get(status) ?? 0 }));
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
