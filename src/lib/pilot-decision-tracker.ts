// ── Step 86: Pilot decision tracker ─────────────────────────────────────────
//
// Records whether operators acted on Step 85 go/no-go recommendations. The
// tracker is governance-only: it never auto-pauses pilots, auto-promotes
// strategies, submits orders, or creates candidates. It just keeps a log of
// what the operator decided and whether they followed through.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getReview } from './pilot-review';

const KEY_PREFIX = 'pilot-decision:';
const SET_KEY = 'pilot-decisions:all';
const MAX_DECISIONS = 2000;

export type Recommendation = 'continue' | 'pause' | 'expand' | 'stop' | 'needs_more_data';
export type Decision = 'accepted' | 'rejected' | 'deferred' | 'modified';
export type DecisionStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export const DECISIONS: Decision[] = ['accepted', 'rejected', 'deferred', 'modified'];
export const DECISION_STATUSES: DecisionStatus[] = ['open', 'in_progress', 'completed', 'cancelled'];
export const RECOMMENDATIONS: Recommendation[] = ['continue', 'pause', 'expand', 'stop', 'needs_more_data'];

const STATUS_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  open:        ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'open'],
  completed:   [],
  cancelled:   [],
};

export interface DecisionRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  pilotId: string;
  pilotName?: string;
  reviewId: string;
  recommendation: Recommendation;
  decision: Decision;
  operatorId: string;
  rationale: string;
  plannedAction?: string;
  dueDate?: string;
  status: DecisionStatus;
  completedAt?: string;
  completedBy?: string;
  linkedActions?: {
    pilotStatusChangeId?: string;
    strategyPromotionId?: string;
    changeRequestId?: string;
  };
  notes?: string[];
}

export class DecisionError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

function newId(): string {
  return `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createDecision(input: {
  reviewId: string;
  decision: Decision;
  operatorId: string;
  rationale: string;
  plannedAction?: string;
  dueDate?: string;
  linkedActions?: DecisionRecord['linkedActions'];
}): Promise<DecisionRecord> {
  if (!DECISIONS.includes(input.decision)) throw new DecisionError(`Invalid decision "${input.decision}"`, 'invalid_decision');
  if (!input.rationale || !input.rationale.trim()) throw new DecisionError('rationale is required', 'rationale_required');

  const review = await getReview(input.reviewId);
  if (!review) throw new DecisionError('Pilot review not found', 'review_not_found');
  if (review.status !== 'completed') {
    throw new DecisionError(`Cannot record a decision on a draft review — complete the review first`, 'review_not_completed');
  }

  const redis = getRedis();
  const now = new Date().toISOString();
  const id = newId();
  const record: DecisionRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    pilotId: review.pilotId,
    pilotName: review.pilotName,
    reviewId: input.reviewId,
    recommendation: review.recommendation as Recommendation,
    decision: input.decision,
    operatorId: input.operatorId,
    rationale: input.rationale.trim(),
    plannedAction: input.plannedAction?.trim(),
    dueDate: input.dueDate,
    status: 'open',
    linkedActions: input.linkedActions,
    notes: [],
  };

  await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(record));
  await redis.zadd(SET_KEY, { score: Date.now(), member: id });
  await trimToCap(redis, SET_KEY, KEY_PREFIX, MAX_DECISIONS);

  await logAuditEvent({
    actor: input.operatorId,
    eventType: 'pilot_decision_recorded',
    targetType: 'pilot',
    targetId: review.pilotId,
    summary: `Decision "${input.decision}" recorded for pilot review ${input.reviewId} (rec: ${review.recommendation})`,
    details: { decisionId: id, reviewId: input.reviewId, recommendation: review.recommendation, decision: input.decision },
  });

  return record;
}

export async function getDecision(id: string): Promise<DecisionRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as DecisionRecord);
}

async function saveDecision(record: DecisionRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${record.id}`, JSON.stringify(record));
}

export async function listDecisions(limit = 500): Promise<DecisionRecord[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_KEY);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_KEY, 0, Math.min(total, limit) - 1, { rev: true });
  const out: DecisionRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function updateDecision(id: string, patch: Partial<Pick<DecisionRecord, 'decision' | 'rationale' | 'plannedAction' | 'dueDate' | 'linkedActions'>>, actor: string): Promise<DecisionRecord | null> {
  const existing = await getDecision(id);
  if (!existing) return null;
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw new DecisionError(`Cannot edit a ${existing.status} decision`, 'illegal_edit');
  }
  if (patch.decision != null && !DECISIONS.includes(patch.decision)) {
    throw new DecisionError(`Invalid decision "${patch.decision}"`, 'invalid_decision');
  }
  const updated: DecisionRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await saveDecision(updated);
  await logAuditEvent({
    actor,
    eventType: 'pilot_decision_updated',
    targetType: 'pilot',
    targetId: existing.pilotId,
    summary: `Decision ${id} updated (${Object.keys(patch).join(', ')})`,
    details: { patchKeys: Object.keys(patch) },
  });
  return updated;
}

export async function transitionDecision(id: string, to: DecisionStatus, actor: string, completionNotes?: string): Promise<DecisionRecord> {
  const existing = await getDecision(id);
  if (!existing) throw new DecisionError('Decision not found', 'not_found');
  const allowed = STATUS_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(to)) {
    throw new DecisionError(`Cannot transition decision from ${existing.status} to ${to}`, 'illegal_transition');
  }
  const now = new Date().toISOString();
  const updated: DecisionRecord = {
    ...existing,
    status: to,
    updatedAt: now,
    completedAt: to === 'completed' ? now : existing.completedAt,
    completedBy: to === 'completed' ? actor : existing.completedBy,
  };
  if (completionNotes && completionNotes.trim()) {
    const stamped = `[${now}] ${actor}: ${completionNotes.trim()}`;
    updated.notes = [...(existing.notes ?? []), stamped];
  }
  await saveDecision(updated);
  await logAuditEvent({
    actor,
    eventType: to === 'completed' ? 'pilot_decision_completed'
            : to === 'cancelled' ? 'pilot_decision_cancelled'
            : 'pilot_decision_status_changed',
    targetType: 'pilot',
    targetId: existing.pilotId,
    summary: `Decision ${id}: ${existing.status} → ${to}`,
    details: { fromStatus: existing.status, toStatus: to, decisionId: id },
  });
  return updated;
}

export async function addNote(id: string, note: string, actor: string): Promise<DecisionRecord | null> {
  const existing = await getDecision(id);
  if (!existing) return null;
  const stamped = `[${new Date().toISOString()}] ${actor}: ${note}`;
  const next: DecisionRecord = {
    ...existing,
    notes: [...(existing.notes ?? []), stamped].slice(-100),
    updatedAt: new Date().toISOString(),
  };
  await saveDecision(next);
  return next;
}

// ── Aggregations ────────────────────────────────────────────────────────────

export interface DecisionSummary {
  total: number;
  byStatus: Record<DecisionStatus, number>;
  byDecision: Record<Decision, number>;
  byRecommendation: Record<Recommendation, number>;
  overdueCount: number;
  acceptanceRatePct: number | null; // accepted / (accepted + rejected + modified) — defer excluded
}

export function isOverdue(d: DecisionRecord, now = Date.now()): boolean {
  if (d.status === 'completed' || d.status === 'cancelled') return false;
  if (!d.dueDate) return false;
  const due = new Date(d.dueDate).getTime();
  if (Number.isNaN(due)) return false;
  return due < now;
}

export function computeSummary(records: DecisionRecord[]): DecisionSummary {
  const byStatus: Record<DecisionStatus, number> = { open: 0, in_progress: 0, completed: 0, cancelled: 0 };
  const byDecision: Record<Decision, number> = { accepted: 0, rejected: 0, deferred: 0, modified: 0 };
  const byRecommendation: Record<Recommendation, number> = { continue: 0, pause: 0, expand: 0, stop: 0, needs_more_data: 0 };
  let overdueCount = 0;
  for (const d of records) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byDecision[d.decision] = (byDecision[d.decision] ?? 0) + 1;
    byRecommendation[d.recommendation] = (byRecommendation[d.recommendation] ?? 0) + 1;
    if (isOverdue(d)) overdueCount++;
  }
  const decided = byDecision.accepted + byDecision.rejected + byDecision.modified;
  return {
    total: records.length,
    byStatus,
    byDecision,
    byRecommendation,
    overdueCount,
    acceptanceRatePct: decided > 0 ? Math.round((byDecision.accepted / decided) * 1000) / 10 : null,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
