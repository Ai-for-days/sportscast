// ── Step 106: Dispute & Correction Workflow ─────────────────────────────────
//
// Documentation + workflow only. Records, investigates, and resolves
// disputed wager outcomes, weather data conflicts, market term challenges,
// settlement preview issues, and operator-error claims. NEVER auto-regrades
// or voids wagers, never settles balances, never reverses transactions,
// never mutates wager outcomes or pricing. Writes confined to dispute:* +
// audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ────────────────────────────────────────────────────────────────────

export type DisputeCategory =
  | 'grading_dispute'
  | 'weather_data_conflict'
  | 'market_terms_dispute'
  | 'settlement_preview_issue'
  | 'operator_error'
  | 'other';

export type DisputeSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'awaiting_evidence'
  | 'recommendation_made'
  | 'resolved'
  | 'closed';

export type ClaimantType = 'user' | 'operator' | 'internal_review' | 'other';

export type RecommendedResolution =
  | 'uphold_original'
  | 'manual_regrade_review'
  | 'manual_void_review'
  | 'request_more_evidence'
  | 'operator_training_followup'
  | 'no_action';

export const DISPUTE_CATEGORIES: DisputeCategory[] = [
  'grading_dispute', 'weather_data_conflict', 'market_terms_dispute',
  'settlement_preview_issue', 'operator_error', 'other',
];
export const DISPUTE_SEVERITIES: DisputeSeverity[] = ['low', 'medium', 'high', 'critical'];
export const DISPUTE_STATUSES: DisputeStatus[] = [
  'open', 'under_review', 'awaiting_evidence', 'recommendation_made', 'resolved', 'closed',
];
export const CLAIMANT_TYPES: ClaimantType[] = ['user', 'operator', 'internal_review', 'other'];
export const RECOMMENDED_RESOLUTIONS: RecommendedResolution[] = [
  'uphold_original', 'manual_regrade_review', 'manual_void_review',
  'request_more_evidence', 'operator_training_followup', 'no_action',
];

const ACTIVE_STATUSES: DisputeStatus[] = ['open', 'under_review', 'awaiting_evidence', 'recommendation_made'];

const STATUS_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  open:                 ['under_review', 'awaiting_evidence', 'closed'],
  under_review:         ['awaiting_evidence', 'recommendation_made', 'open'],
  awaiting_evidence:    ['under_review', 'recommendation_made', 'open'],
  recommendation_made:  ['under_review', 'awaiting_evidence', 'resolved'],
  resolved:             ['closed', 'under_review'],   // reopen via under_review
  closed:               [],                            // terminal
};

export interface DisputeTimelineEntry {
  at: string;
  actor: string;
  action: string;
  note?: string;
}

export interface DisputeRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  status: DisputeStatus;
  category: DisputeCategory;
  severity: DisputeSeverity;
  title: string;
  description: string;
  relatedWagerId?: string;
  relatedEvidenceId?: string;
  relatedIncidentId?: string;
  relatedSettlementPreviewId?: string;
  claimantType?: ClaimantType;
  claimantReference?: string;
  requestedOutcome?: string;
  currentOutcome?: string;
  recommendedResolution?: RecommendedResolution;
  rationale?: string;
  recommendationMadeAt?: string;
  recommendationMadeBy?: string;
  timeline: DisputeTimelineEntry[];
  notes: string[];
  resolvedAt?: string;
  resolvedBy?: string;
  closedAt?: string;
  closedBy?: string;
}

export interface DisputeSummary {
  total: number;
  byStatus: Record<DisputeStatus, number>;
  bySeverity: Record<DisputeSeverity, number>;
  byCategory: Record<DisputeCategory, number>;
  byRecommendation: Record<RecommendedResolution, number>;
  openCount: number;
  criticalOpen: number;
  awaitingEvidence: number;
  ageMs: { medianActive: number | null; maxActive: number | null };
}

export class DisputeError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const DISPUTE_PREFIX = 'dispute:';
const DISPUTES_ALL = 'disputes:all';
const DISPUTES_OPEN = 'disputes:open';
const DISPUTES_BY_SEVERITY_PREFIX = 'disputes:by-severity:';
const DISPUTES_BY_WAGER_PREFIX = 'disputes:wager:';
const MAX_DISPUTES = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function newDisputeId(): string {
  return `disp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }
function isActive(status: DisputeStatus): boolean { return ACTIVE_STATUSES.includes(status); }

// ── Persistence ──────────────────────────────────────────────────────────────

async function saveDispute(rec: DisputeRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${DISPUTE_PREFIX}${rec.id}`, JSON.stringify(rec));
}

export async function getDispute(id: string): Promise<DisputeRecord | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${DISPUTE_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as DisputeRecord);
}

async function readIdsFrom(zsetKey: string, limit: number): Promise<string[]> {
  const redis = getRedis();
  const total = await redis.zcard(zsetKey);
  if (total === 0) return [];
  return await redis.zrange(zsetKey, 0, Math.min(total, limit) - 1, { rev: true });
}

async function loadIds(ids: string[]): Promise<DisputeRecord[]> {
  const redis = getRedis();
  const out: DisputeRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${DISPUTE_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export interface ListOptions {
  limit?: number;
  status?: DisputeStatus;
  severity?: DisputeSeverity;
  category?: DisputeCategory;
}

export async function listDisputes(opts: ListOptions = {}): Promise<DisputeRecord[]> {
  const limit = opts.limit ?? 200;
  let ids: string[];
  if (opts.severity) {
    ids = await readIdsFrom(`${DISPUTES_BY_SEVERITY_PREFIX}${opts.severity}`, limit * 2);
  } else if (opts.status && isActive(opts.status)) {
    ids = await readIdsFrom(DISPUTES_OPEN, limit * 2);
  } else {
    ids = await readIdsFrom(DISPUTES_ALL, limit * 2);
  }
  let recs = await loadIds(ids);
  if (opts.status) recs = recs.filter(r => r.status === opts.status);
  if (opts.category) recs = recs.filter(r => r.category === opts.category);
  return recs.slice(0, limit);
}

export async function listOpenDisputes(limit = 200): Promise<DisputeRecord[]> {
  const ids = await readIdsFrom(DISPUTES_OPEN, limit * 2);
  const recs = await loadIds(ids);
  return recs.filter(r => isActive(r.status)).slice(0, limit);
}

export async function listDisputesForWager(wagerId: string, limit = 100): Promise<DisputeRecord[]> {
  if (!wagerId) return [];
  const ids = await readIdsFrom(`${DISPUTES_BY_WAGER_PREFIX}${wagerId}`, limit);
  return await loadIds(ids);
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateDisputeInput {
  title: string;
  description: string;
  category: DisputeCategory;
  severity: DisputeSeverity;
  relatedWagerId?: string;
  relatedEvidenceId?: string;
  relatedIncidentId?: string;
  relatedSettlementPreviewId?: string;
  claimantType?: ClaimantType;
  claimantReference?: string;
  requestedOutcome?: string;
  currentOutcome?: string;
}

export async function createDispute(input: CreateDisputeInput, actor: string): Promise<DisputeRecord> {
  if (!actor) throw new DisputeError('actor is required', 'actor_required');
  if (!input.title?.trim()) throw new DisputeError('title is required', 'title_required');
  if (!input.description?.trim()) throw new DisputeError('description is required', 'description_required');
  if (!DISPUTE_CATEGORIES.includes(input.category)) {
    throw new DisputeError(`Invalid category "${input.category}"`, 'invalid_category');
  }
  if (!DISPUTE_SEVERITIES.includes(input.severity)) {
    throw new DisputeError(`Invalid severity "${input.severity}"`, 'invalid_severity');
  }
  if (input.claimantType && !CLAIMANT_TYPES.includes(input.claimantType)) {
    throw new DisputeError(`Invalid claimantType "${input.claimantType}"`, 'invalid_claimant_type');
  }

  const id = newDisputeId();
  const now = nowIso();
  const rec: DisputeRecord = {
    id,
    createdAt: now,
    createdBy: actor,
    status: 'open',
    category: input.category,
    severity: input.severity,
    title: input.title.trim(),
    description: input.description.trim(),
    relatedWagerId: input.relatedWagerId?.trim() || undefined,
    relatedEvidenceId: input.relatedEvidenceId?.trim() || undefined,
    relatedIncidentId: input.relatedIncidentId?.trim() || undefined,
    relatedSettlementPreviewId: input.relatedSettlementPreviewId?.trim() || undefined,
    claimantType: input.claimantType,
    claimantReference: input.claimantReference?.trim() || undefined,
    requestedOutcome: input.requestedOutcome?.trim() || undefined,
    currentOutcome: input.currentOutcome?.trim() || undefined,
    timeline: [{ at: now, actor, action: 'created' }],
    notes: [],
  };

  await saveDispute(rec);

  const redis = getRedis();
  await redis.zadd(DISPUTES_ALL, { score: Date.now(), member: id });
  await redis.zadd(DISPUTES_OPEN, { score: Date.now(), member: id });
  await redis.zadd(`${DISPUTES_BY_SEVERITY_PREFIX}${input.severity}`, { score: Date.now(), member: id });
  if (rec.relatedWagerId) {
    await redis.zadd(`${DISPUTES_BY_WAGER_PREFIX}${rec.relatedWagerId}`, { score: Date.now(), member: id });
  }
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'dispute_created',
    targetType: 'dispute',
    targetId: id,
    summary: `Dispute ${id} created (${input.category}/${input.severity}): ${input.title.trim().slice(0, 120)}`,
    details: { id, category: input.category, severity: input.severity, relatedWagerId: rec.relatedWagerId },
  });

  return rec;
}

// ── Notes / status ──────────────────────────────────────────────────────────

export async function addNote(id: string, note: string, actor: string): Promise<DisputeRecord> {
  if (!actor) throw new DisputeError('actor is required', 'actor_required');
  if (!note?.trim()) throw new DisputeError('note is required', 'note_required');

  const rec = await getDispute(id);
  if (!rec) throw new DisputeError('Dispute not found', 'dispute_not_found');

  const stamped = `[${nowIso()}] ${actor}: ${note.trim()}`;
  rec.notes = [...(rec.notes ?? []), stamped].slice(-200);
  rec.timeline = [...rec.timeline, { at: nowIso(), actor, action: 'note', note: note.trim() }].slice(-500);
  await saveDispute(rec);

  await logAuditEvent({
    actor,
    eventType: 'dispute_note_added',
    targetType: 'dispute',
    targetId: id,
    summary: `Note added to dispute ${id}`,
    details: { id },
  });

  return rec;
}

export async function changeStatus(id: string, to: DisputeStatus, actor: string, note?: string): Promise<DisputeRecord> {
  if (!actor) throw new DisputeError('actor is required', 'actor_required');
  if (!DISPUTE_STATUSES.includes(to)) throw new DisputeError(`Invalid status "${to}"`, 'invalid_status');
  if (to === 'recommendation_made') throw new DisputeError('Use makeRecommendation', 'use_recommendation_endpoint');
  if (to === 'resolved') throw new DisputeError('Use resolveDispute', 'use_resolve_endpoint');
  if (to === 'closed') throw new DisputeError('Use closeDispute', 'use_close_endpoint');

  const rec = await getDispute(id);
  if (!rec) throw new DisputeError('Dispute not found', 'dispute_not_found');

  const allowed = STATUS_TRANSITIONS[rec.status] ?? [];
  if (!allowed.includes(to)) {
    throw new DisputeError(`Cannot transition from ${rec.status} to ${to}`, 'illegal_transition');
  }

  const from = rec.status;
  const now = nowIso();
  rec.status = to;
  rec.timeline = [...rec.timeline, {
    at: now, actor,
    action: `status_changed:${from}→${to}`,
    note: note?.trim() || undefined,
  }].slice(-500);

  // Reopen from resolved → under_review wipes the resolution stamps but keeps the recommendation
  if (from === 'resolved') {
    rec.resolvedAt = undefined;
    rec.resolvedBy = undefined;
  }

  await saveDispute(rec);

  // Index maintenance
  const redis = getRedis();
  if (isActive(to) && !isActive(from)) {
    await redis.zadd(DISPUTES_OPEN, { score: Date.now(), member: id });
  } else if (!isActive(to) && isActive(from)) {
    await redis.zrem(DISPUTES_OPEN, id);
  }

  await logAuditEvent({
    actor,
    eventType: 'dispute_status_changed',
    targetType: 'dispute',
    targetId: id,
    summary: `Dispute ${id} status: ${from} → ${to}`,
    details: { id, from, to, note: note?.trim() },
  });

  return rec;
}

// ── Recommendation ───────────────────────────────────────────────────────────

export async function makeRecommendation(input: {
  id: string;
  recommendedResolution: RecommendedResolution;
  rationale: string;
  actor: string;
}): Promise<DisputeRecord> {
  if (!input.actor) throw new DisputeError('actor is required', 'actor_required');
  if (!RECOMMENDED_RESOLUTIONS.includes(input.recommendedResolution)) {
    throw new DisputeError(`Invalid recommendedResolution "${input.recommendedResolution}"`, 'invalid_recommendation');
  }
  if (!input.rationale?.trim()) {
    throw new DisputeError('rationale is required to make a recommendation', 'rationale_required');
  }

  const rec = await getDispute(input.id);
  if (!rec) throw new DisputeError('Dispute not found', 'dispute_not_found');

  // Recommendation can only be made from under_review or awaiting_evidence
  if (rec.status !== 'under_review' && rec.status !== 'awaiting_evidence') {
    // Allow re-recommending from recommendation_made (revising)
    if (rec.status !== 'recommendation_made') {
      throw new DisputeError(
        `Cannot make recommendation from status ${rec.status}. Move to under_review first.`,
        'illegal_recommendation_from_status',
      );
    }
  }

  const from = rec.status;
  const now = nowIso();
  rec.recommendedResolution = input.recommendedResolution;
  rec.rationale = input.rationale.trim();
  rec.recommendationMadeAt = now;
  rec.recommendationMadeBy = input.actor;
  rec.status = 'recommendation_made';
  rec.timeline = [...rec.timeline, {
    at: now, actor: input.actor,
    action: from === 'recommendation_made'
      ? `recommendation_revised:${input.recommendedResolution}`
      : `recommendation_made:${input.recommendedResolution}`,
    note: input.rationale.trim(),
  }].slice(-500);
  await saveDispute(rec);

  // recommendation_made is active — ensure index membership
  const redis = getRedis();
  await redis.zadd(DISPUTES_OPEN, { score: Date.now(), member: rec.id });

  await logAuditEvent({
    actor: input.actor,
    eventType: 'dispute_recommendation_made',
    targetType: 'dispute',
    targetId: rec.id,
    summary: `Dispute ${rec.id}: recommendation = ${input.recommendedResolution}`,
    details: {
      id: rec.id, from, recommendedResolution: input.recommendedResolution,
      rationale: input.rationale.trim().slice(0, 300),
    },
  });

  return rec;
}

// ── Resolve ──────────────────────────────────────────────────────────────────

export async function resolveDispute(id: string, actor: string, note?: string): Promise<DisputeRecord> {
  if (!actor) throw new DisputeError('actor is required', 'actor_required');

  const rec = await getDispute(id);
  if (!rec) throw new DisputeError('Dispute not found', 'dispute_not_found');

  if (rec.status !== 'recommendation_made') {
    throw new DisputeError('Resolve requires status=recommendation_made (i.e. a recommendation must be on file).', 'recommendation_required');
  }
  if (!rec.recommendedResolution || !rec.rationale) {
    throw new DisputeError('Resolve requires a recommendation with rationale on the dispute record.', 'recommendation_required');
  }

  const now = nowIso();
  rec.status = 'resolved';
  rec.resolvedAt = now;
  rec.resolvedBy = actor;
  rec.timeline = [...rec.timeline, {
    at: now, actor,
    action: `status_changed:recommendation_made→resolved`,
    note: note?.trim() || undefined,
  }].slice(-500);
  await saveDispute(rec);

  // Resolved is not active — remove from open index
  const redis = getRedis();
  await redis.zrem(DISPUTES_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'dispute_resolved',
    targetType: 'dispute',
    targetId: id,
    summary: `Dispute ${id} resolved (${rec.recommendedResolution})`,
    details: { id, recommendedResolution: rec.recommendedResolution },
  });

  return rec;
}

// ── Close ────────────────────────────────────────────────────────────────────

export async function closeDispute(id: string, actor: string, note?: string): Promise<DisputeRecord> {
  if (!actor) throw new DisputeError('actor is required', 'actor_required');

  const rec = await getDispute(id);
  if (!rec) throw new DisputeError('Dispute not found', 'dispute_not_found');
  if (rec.status !== 'resolved') {
    throw new DisputeError('Close requires the dispute to be resolved first', 'must_resolve_first');
  }

  const now = nowIso();
  rec.status = 'closed';
  rec.closedAt = now;
  rec.closedBy = actor;
  rec.timeline = [...rec.timeline, {
    at: now, actor,
    action: `status_changed:resolved→closed`,
    note: note?.trim() || undefined,
  }].slice(-500);
  await saveDispute(rec);

  // No-op for open index (resolved already removed it), but defensive:
  const redis = getRedis();
  await redis.zrem(DISPUTES_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'dispute_closed',
    targetType: 'dispute',
    targetId: id,
    summary: `Dispute ${id} closed${note ? `: ${note.trim().slice(0, 120)}` : ''}`,
    details: { id, note: note?.trim() },
  });

  return rec;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export async function getDisputeSummary(): Promise<DisputeSummary> {
  const recs = await listDisputes({ limit: 500 });
  const byStatus: Record<DisputeStatus, number> = {
    open: 0, under_review: 0, awaiting_evidence: 0,
    recommendation_made: 0, resolved: 0, closed: 0,
  };
  const bySeverity: Record<DisputeSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byCategory: Record<DisputeCategory, number> = {
    grading_dispute: 0, weather_data_conflict: 0, market_terms_dispute: 0,
    settlement_preview_issue: 0, operator_error: 0, other: 0,
  };
  const byRecommendation: Record<RecommendedResolution, number> = {
    uphold_original: 0, manual_regrade_review: 0, manual_void_review: 0,
    request_more_evidence: 0, operator_training_followup: 0, no_action: 0,
  };

  let openCount = 0;
  let criticalOpen = 0;
  let awaitingEvidence = 0;
  const activeAges: number[] = [];
  const now = Date.now();

  for (const r of recs) {
    byStatus[r.status]++;
    bySeverity[r.severity]++;
    byCategory[r.category]++;
    if (r.recommendedResolution) byRecommendation[r.recommendedResolution]++;
    if (isActive(r.status)) {
      openCount++;
      if (r.severity === 'critical') criticalOpen++;
      if (r.status === 'awaiting_evidence') awaitingEvidence++;
      const age = now - new Date(r.createdAt).getTime();
      if (Number.isFinite(age) && age >= 0) activeAges.push(age);
    }
  }

  let medianActive: number | null = null;
  let maxActive: number | null = null;
  if (activeAges.length > 0) {
    activeAges.sort((a, b) => a - b);
    const mid = Math.floor(activeAges.length / 2);
    medianActive = activeAges.length % 2 === 1
      ? activeAges[mid]
      : Math.round((activeAges[mid - 1] + activeAges[mid]) / 2);
    maxActive = activeAges[activeAges.length - 1];
  }

  return {
    total: recs.length,
    byStatus, bySeverity, byCategory, byRecommendation,
    openCount, criticalOpen, awaitingEvidence,
    ageMs: { medianActive, maxActive },
  };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(DISPUTES_ALL);
  if (total <= MAX_DISPUTES) return;
  const overflow = total - MAX_DISPUTES;
  const oldest = await redis.zrange(DISPUTES_ALL, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(DISPUTES_ALL, 0, overflow - 1);
    for (const oldId of oldest) {
      await redis.del(`${DISPUTE_PREFIX}${oldId}`);
      await redis.zrem(DISPUTES_OPEN, oldId);
      for (const sev of DISPUTE_SEVERITIES) {
        await redis.zrem(`${DISPUTES_BY_SEVERITY_PREFIX}${sev}`, oldId);
      }
    }
  }
}
