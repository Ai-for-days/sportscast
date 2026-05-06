// ── Step 107: Wager Change Control & Approval Workflow ─────────────────────
//
// Approval + documentation workflow for material changes to wagers.
// NEVER mutates wagers, odds, lines, lock times, outcomes, balances, or
// pricing. The "implementation" step is a manual stamp recording that the
// operator made the actual change in the appropriate tool. Writes confined
// to wager-change:* + audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ────────────────────────────────────────────────────────────────────

export type ChangeStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'implemented_manually'
  | 'closed';

export type ChangeType =
  | 'odds_change'
  | 'line_change'
  | 'description_change'
  | 'lock_time_change'
  | 'market_terms_change'
  | 'manual_void_request'
  | 'manual_regrade_request'
  | 'settlement_review_request'
  | 'other';

export type ChangeSeverity = 'low' | 'medium' | 'high' | 'critical';

export const CHANGE_STATUSES: ChangeStatus[] = [
  'draft', 'submitted', 'under_review', 'approved', 'rejected',
  'withdrawn', 'implemented_manually', 'closed',
];
export const CHANGE_TYPES: ChangeType[] = [
  'odds_change', 'line_change', 'description_change', 'lock_time_change',
  'market_terms_change', 'manual_void_request', 'manual_regrade_request',
  'settlement_review_request', 'other',
];
export const CHANGE_SEVERITIES: ChangeSeverity[] = ['low', 'medium', 'high', 'critical'];

const ACTIVE_STATUSES: ChangeStatus[] = ['draft', 'submitted', 'under_review', 'approved'];

const STATUS_TRANSITIONS: Record<ChangeStatus, ChangeStatus[]> = {
  draft:                ['submitted', 'withdrawn'],
  submitted:            ['under_review', 'approved', 'rejected', 'withdrawn'],
  under_review:         ['approved', 'rejected', 'withdrawn', 'submitted'],
  approved:             ['implemented_manually', 'closed'],
  rejected:             ['closed'],
  withdrawn:            ['closed'],
  implemented_manually: ['closed'],
  closed:               [],
};

export interface ApprovalEntry {
  at: string;
  actor: string;
  decision: 'approved' | 'rejected';
  note?: string;
}

export interface ChangeTimelineEntry {
  at: string;
  actor: string;
  action: string;
  note?: string;
}

export interface ChangeRequest {
  id: string;
  createdAt: string;
  createdBy: string;
  status: ChangeStatus;
  changeType: ChangeType;
  severity: ChangeSeverity;
  relatedWagerId: string;
  relatedIncidentId?: string;
  relatedDisputeId?: string;
  relatedEvidenceId?: string;
  requestedChangeSummary: string;
  currentStateSnapshot?: string;
  proposedStateSnapshot?: string;
  rationale: string;
  riskAssessment?: string;
  approvals: ApprovalEntry[];
  timeline: ChangeTimelineEntry[];
  implementationNote?: string;
  implementedAt?: string;
  implementedBy?: string;
  submittedAt?: string;
  submittedBy?: string;
  closedAt?: string;
  closedBy?: string;
}

export interface ChangeSummary {
  total: number;
  byStatus: Record<ChangeStatus, number>;
  bySeverity: Record<ChangeSeverity, number>;
  byChangeType: Record<ChangeType, number>;
  openCount: number;
  awaitingApproval: number;
  approvedNotImplemented: number;
  ageMs: { medianActive: number | null; maxActive: number | null };
}

export class ChangeControlError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const CHANGE_PREFIX = 'wager-change:';
const CHANGES_ALL = 'wager-changes:all';
const CHANGES_OPEN = 'wager-changes:open';
const CHANGES_BY_WAGER_PREFIX = 'wager-changes:wager:';
const MAX_CHANGES = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function newChangeId(): string {
  return `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }
function isActive(status: ChangeStatus): boolean { return ACTIVE_STATUSES.includes(status); }

// ── Persistence ──────────────────────────────────────────────────────────────

async function saveChange(rec: ChangeRequest): Promise<void> {
  const redis = getRedis();
  await redis.set(`${CHANGE_PREFIX}${rec.id}`, JSON.stringify(rec));
}

export async function getChange(id: string): Promise<ChangeRequest | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${CHANGE_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as ChangeRequest);
}

async function readIdsFrom(zsetKey: string, limit: number): Promise<string[]> {
  const redis = getRedis();
  const total = await redis.zcard(zsetKey);
  if (total === 0) return [];
  return await redis.zrange(zsetKey, 0, Math.min(total, limit) - 1, { rev: true });
}

async function loadIds(ids: string[]): Promise<ChangeRequest[]> {
  const redis = getRedis();
  const out: ChangeRequest[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${CHANGE_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export interface ListOptions {
  limit?: number;
  status?: ChangeStatus;
  severity?: ChangeSeverity;
  changeType?: ChangeType;
}

export async function listChanges(opts: ListOptions = {}): Promise<ChangeRequest[]> {
  const limit = opts.limit ?? 200;
  const ids = opts.status && isActive(opts.status)
    ? await readIdsFrom(CHANGES_OPEN, limit * 2)
    : await readIdsFrom(CHANGES_ALL, limit * 2);
  let recs = await loadIds(ids);
  if (opts.status) recs = recs.filter(r => r.status === opts.status);
  if (opts.severity) recs = recs.filter(r => r.severity === opts.severity);
  if (opts.changeType) recs = recs.filter(r => r.changeType === opts.changeType);
  return recs.slice(0, limit);
}

export async function listOpenChanges(limit = 200): Promise<ChangeRequest[]> {
  const ids = await readIdsFrom(CHANGES_OPEN, limit * 2);
  const recs = await loadIds(ids);
  return recs.filter(r => isActive(r.status)).slice(0, limit);
}

export async function listChangesForWager(wagerId: string, limit = 100): Promise<ChangeRequest[]> {
  if (!wagerId) return [];
  const ids = await readIdsFrom(`${CHANGES_BY_WAGER_PREFIX}${wagerId}`, limit);
  return await loadIds(ids);
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateChangeRequestInput {
  relatedWagerId: string;
  changeType: ChangeType;
  severity: ChangeSeverity;
  requestedChangeSummary: string;
  rationale: string;
  currentStateSnapshot?: string;
  proposedStateSnapshot?: string;
  riskAssessment?: string;
  relatedIncidentId?: string;
  relatedDisputeId?: string;
  relatedEvidenceId?: string;
}

export async function createChangeRequest(input: CreateChangeRequestInput, actor: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');
  if (!input.relatedWagerId?.trim()) throw new ChangeControlError('relatedWagerId is required', 'wager_required');
  if (!CHANGE_TYPES.includes(input.changeType)) {
    throw new ChangeControlError(`Invalid changeType "${input.changeType}"`, 'invalid_change_type');
  }
  if (!CHANGE_SEVERITIES.includes(input.severity)) {
    throw new ChangeControlError(`Invalid severity "${input.severity}"`, 'invalid_severity');
  }
  if (!input.requestedChangeSummary?.trim()) {
    throw new ChangeControlError('requestedChangeSummary is required', 'summary_required');
  }
  if (!input.rationale?.trim()) {
    throw new ChangeControlError('rationale is required', 'rationale_required');
  }

  const id = newChangeId();
  const now = nowIso();
  const rec: ChangeRequest = {
    id,
    createdAt: now,
    createdBy: actor,
    status: 'draft',
    changeType: input.changeType,
    severity: input.severity,
    relatedWagerId: input.relatedWagerId.trim(),
    relatedIncidentId: input.relatedIncidentId?.trim() || undefined,
    relatedDisputeId: input.relatedDisputeId?.trim() || undefined,
    relatedEvidenceId: input.relatedEvidenceId?.trim() || undefined,
    requestedChangeSummary: input.requestedChangeSummary.trim(),
    currentStateSnapshot: input.currentStateSnapshot?.trim() || undefined,
    proposedStateSnapshot: input.proposedStateSnapshot?.trim() || undefined,
    rationale: input.rationale.trim(),
    riskAssessment: input.riskAssessment?.trim() || undefined,
    approvals: [],
    timeline: [{ at: now, actor, action: 'created' }],
  };

  await saveChange(rec);

  const redis = getRedis();
  await redis.zadd(CHANGES_ALL, { score: Date.now(), member: id });
  await redis.zadd(CHANGES_OPEN, { score: Date.now(), member: id });
  await redis.zadd(`${CHANGES_BY_WAGER_PREFIX}${rec.relatedWagerId}`, { score: Date.now(), member: id });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_created',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} created (${input.changeType}/${input.severity}) for wager ${rec.relatedWagerId}: ${input.requestedChangeSummary.trim().slice(0, 120)}`,
    details: { id, relatedWagerId: rec.relatedWagerId, changeType: input.changeType, severity: input.severity },
  });

  return rec;
}

// ── Submit / withdraw / status helpers ──────────────────────────────────────

export async function submitForReview(id: string, actor: string, note?: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');
  if (rec.status !== 'draft') {
    throw new ChangeControlError(`Submit only allowed from draft (current: ${rec.status})`, 'illegal_transition');
  }

  const now = nowIso();
  rec.status = 'submitted';
  rec.submittedAt = now;
  rec.submittedBy = actor;
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: 'status_changed:draft→submitted', note: note?.trim() || undefined,
  }].slice(-500);
  await saveChange(rec);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_submitted',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} submitted for review`,
    details: { id, relatedWagerId: rec.relatedWagerId },
  });

  return rec;
}

export async function withdrawChange(id: string, actor: string, note?: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');
  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');

  const allowed = STATUS_TRANSITIONS[rec.status] ?? [];
  if (!allowed.includes('withdrawn')) {
    throw new ChangeControlError(`Withdraw not allowed from status ${rec.status}`, 'illegal_transition');
  }

  const from = rec.status;
  const now = nowIso();
  rec.status = 'withdrawn';
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: `status_changed:${from}→withdrawn`, note: note?.trim() || undefined,
  }].slice(-500);
  await saveChange(rec);

  // withdrawn is not active — remove from open index
  const redis = getRedis();
  await redis.zrem(CHANGES_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_withdrawn',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} withdrawn (was ${from})`,
    details: { id, from, note: note?.trim() },
  });

  return rec;
}

// ── Notes ────────────────────────────────────────────────────────────────────

export async function addChangeNote(id: string, note: string, actor: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');
  if (!note?.trim()) throw new ChangeControlError('note is required', 'note_required');

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');

  rec.timeline = [...rec.timeline, { at: nowIso(), actor, action: 'note', note: note.trim() }].slice(-500);
  await saveChange(rec);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_note_added',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Note added to change request ${id}`,
    details: { id },
  });

  return rec;
}

// ── Approve / Reject ─────────────────────────────────────────────────────────

export async function approveChange(id: string, actor: string, note?: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');
  if (rec.status !== 'submitted' && rec.status !== 'under_review') {
    throw new ChangeControlError(`Approve only allowed from submitted or under_review (current: ${rec.status})`, 'illegal_approval');
  }

  // Self-approve guard for high/critical: the createdBy operator should not be the sole approver.
  // We don't hard-block (operator may legitimately submit + approve in single-operator setups), but
  // we do flag it via the audit details so reviewers can spot it.
  const isSelfApproval = actor === rec.createdBy;

  const from = rec.status;
  const now = nowIso();
  rec.approvals = [...rec.approvals, { at: now, actor, decision: 'approved', note: note?.trim() || undefined }];
  rec.status = 'approved';
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: `status_changed:${from}→approved`, note: note?.trim() || undefined,
  }].slice(-500);
  await saveChange(rec);

  // approved is still active — keep in open index for visibility until implemented or closed
  // (no index change needed; it was already in CHANGES_OPEN)

  await logAuditEvent({
    actor,
    eventType: 'wager_change_approved',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} approved by ${actor}${isSelfApproval ? ' (self-approval)' : ''}`,
    details: {
      id, from, severity: rec.severity, changeType: rec.changeType,
      isSelfApproval, approvalCount: rec.approvals.length,
    },
  });

  return rec;
}

export async function rejectChange(id: string, actor: string, note: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');
  if (!note?.trim()) throw new ChangeControlError('A rejection note is required', 'note_required');

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');
  if (rec.status !== 'submitted' && rec.status !== 'under_review') {
    throw new ChangeControlError(`Reject only allowed from submitted or under_review (current: ${rec.status})`, 'illegal_rejection');
  }

  const from = rec.status;
  const now = nowIso();
  rec.approvals = [...rec.approvals, { at: now, actor, decision: 'rejected', note: note.trim() }];
  rec.status = 'rejected';
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: `status_changed:${from}→rejected`, note: note.trim(),
  }].slice(-500);
  await saveChange(rec);

  // rejected is not active — remove from open index
  const redis = getRedis();
  await redis.zrem(CHANGES_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_rejected',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} rejected by ${actor}: ${note.trim().slice(0, 120)}`,
    details: { id, from, severity: rec.severity, changeType: rec.changeType, note: note.trim() },
  });

  return rec;
}

// ── Mark implemented manually ────────────────────────────────────────────────

export async function markImplementedManually(id: string, actor: string, implementationNote: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');
  if (!implementationNote?.trim()) {
    throw new ChangeControlError('An implementation note is required (where / how the change was applied)', 'implementation_note_required');
  }

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');
  if (rec.status !== 'approved') {
    throw new ChangeControlError(`mark-implemented-manually only allowed after approval (current: ${rec.status})`, 'illegal_implementation');
  }
  if (rec.approvals.filter(a => a.decision === 'approved').length === 0) {
    throw new ChangeControlError('No approval entries on file', 'no_approval_on_file');
  }

  const now = nowIso();
  rec.status = 'implemented_manually';
  rec.implementationNote = implementationNote.trim();
  rec.implementedAt = now;
  rec.implementedBy = actor;
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: 'status_changed:approved→implemented_manually', note: implementationNote.trim(),
  }].slice(-500);
  await saveChange(rec);

  // implemented_manually is not active — remove from open index
  const redis = getRedis();
  await redis.zrem(CHANGES_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_marked_implemented_manually',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} marked implemented manually by ${actor}`,
    details: { id, implementationNote: implementationNote.trim(), relatedWagerId: rec.relatedWagerId },
  });

  return rec;
}

// ── Close ────────────────────────────────────────────────────────────────────

export async function closeChange(id: string, actor: string, note?: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');
  if (rec.status !== 'rejected' && rec.status !== 'withdrawn' && rec.status !== 'implemented_manually') {
    throw new ChangeControlError(
      `Close only allowed after rejected, withdrawn, or implemented_manually (current: ${rec.status})`,
      'illegal_close',
    );
  }

  const from = rec.status;
  const now = nowIso();
  rec.status = 'closed';
  rec.closedAt = now;
  rec.closedBy = actor;
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: `status_changed:${from}→closed`, note: note?.trim() || undefined,
  }].slice(-500);
  await saveChange(rec);

  // No-op for open index (already removed by the from-state transition), defensive:
  const redis = getRedis();
  await redis.zrem(CHANGES_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_closed',
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} closed${note ? `: ${note.trim().slice(0, 120)}` : ''}`,
    details: { id, from, note: note?.trim() },
  });

  return rec;
}

// ── Generic status change (under_review only) ───────────────────────────────

export async function moveToUnderReview(id: string, actor: string, note?: string): Promise<ChangeRequest> {
  if (!actor) throw new ChangeControlError('actor is required', 'actor_required');

  const rec = await getChange(id);
  if (!rec) throw new ChangeControlError('Change request not found', 'change_not_found');
  if (rec.status !== 'submitted') {
    throw new ChangeControlError(`Can only move to under_review from submitted (current: ${rec.status})`, 'illegal_transition');
  }

  const from = rec.status;
  const now = nowIso();
  rec.status = 'under_review';
  rec.timeline = [...rec.timeline, {
    at: now, actor, action: `status_changed:${from}→under_review`, note: note?.trim() || undefined,
  }].slice(-500);
  await saveChange(rec);

  await logAuditEvent({
    actor,
    eventType: 'wager_change_note_added',           // reuse note event for status moves that aren't tracked separately
    targetType: 'wager_change_request',
    targetId: id,
    summary: `Change request ${id} moved to under_review`,
    details: { id, from, to: 'under_review', note: note?.trim() },
  });

  return rec;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export async function getChangeSummary(): Promise<ChangeSummary> {
  const recs = await listChanges({ limit: 500 });
  const byStatus: Record<ChangeStatus, number> = {
    draft: 0, submitted: 0, under_review: 0, approved: 0, rejected: 0,
    withdrawn: 0, implemented_manually: 0, closed: 0,
  };
  const bySeverity: Record<ChangeSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byChangeType: Record<ChangeType, number> = {
    odds_change: 0, line_change: 0, description_change: 0, lock_time_change: 0,
    market_terms_change: 0, manual_void_request: 0, manual_regrade_request: 0,
    settlement_review_request: 0, other: 0,
  };

  let openCount = 0;
  let awaitingApproval = 0;
  let approvedNotImplemented = 0;
  const activeAges: number[] = [];
  const now = Date.now();

  for (const r of recs) {
    byStatus[r.status]++;
    bySeverity[r.severity]++;
    byChangeType[r.changeType]++;
    if (isActive(r.status)) {
      openCount++;
      if (r.status === 'submitted' || r.status === 'under_review') awaitingApproval++;
      if (r.status === 'approved') approvedNotImplemented++;
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
    byStatus, bySeverity, byChangeType,
    openCount, awaitingApproval, approvedNotImplemented,
    ageMs: { medianActive, maxActive },
  };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(CHANGES_ALL);
  if (total <= MAX_CHANGES) return;
  const overflow = total - MAX_CHANGES;
  const oldest = await redis.zrange(CHANGES_ALL, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(CHANGES_ALL, 0, overflow - 1);
    for (const oldId of oldest) {
      await redis.del(`${CHANGE_PREFIX}${oldId}`);
      await redis.zrem(CHANGES_OPEN, oldId);
    }
  }
}
