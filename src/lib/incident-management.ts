// ── Step 104: Incident & Exception Management Center ───────────────────────
//
// Documentation + workflow only. Records, triages, investigates, and resolves
// operational issues. NEVER auto-voids wagers, auto-grades, freezes users,
// changes pricing, or settles balances. Writes are confined to incident:*
// keys plus the audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ────────────────────────────────────────────────────────────────────

export type IncidentCategory =
  | 'market_design'
  | 'pricing'
  | 'grading'
  | 'settlement_preview'
  | 'integrity'
  | 'operator_governance'
  | 'system'
  | 'other';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'monitoring'
  | 'resolved'
  | 'closed';

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  'market_design', 'pricing', 'grading', 'settlement_preview',
  'integrity', 'operator_governance', 'system', 'other',
];
export const INCIDENT_SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
export const INCIDENT_STATUSES: IncidentStatus[] = ['open', 'investigating', 'monitoring', 'resolved', 'closed'];

const ACTIVE_STATUSES: IncidentStatus[] = ['open', 'investigating', 'monitoring'];

const STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open:          ['investigating', 'monitoring', 'resolved'],
  investigating: ['monitoring', 'resolved', 'open'],
  monitoring:    ['investigating', 'resolved', 'open'],
  resolved:      ['closed', 'open'],          // reopen allowed
  closed:        [],                            // terminal
};

export interface TimelineEntry {
  at: string;
  actor: string;
  action: string;       // e.g. 'created', 'status_changed', 'note', 'resolved', 'closed'
  note?: string;
}

export interface IncidentRecord {
  id: string;
  createdAt: string;
  createdBy: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  relatedWagerId?: string;
  relatedOperatorId?: string;
  relatedIntegrityReportId?: string;
  relatedSettlementPreviewId?: string;
  relatedCertificationId?: string;
  relatedRbacReviewId?: string;
  relatedRunbookDate?: string;
  relatedEodReportDate?: string;
  tags: string[];
  timeline: TimelineEntry[];
  resolutionSummary?: string;
  followUpActions: string[];
  warnings: string[];
  resolutionConfirmedAt?: string;
  resolutionConfirmedBy?: string;
  closedAt?: string;
  closedBy?: string;
}

export interface IncidentSummary {
  total: number;
  byStatus: Record<IncidentStatus, number>;
  bySeverity: Record<IncidentSeverity, number>;
  byCategory: Record<IncidentCategory, number>;
  openCount: number;
  criticalOpen: number;
  /** Median + max age (ms) across active incidents. */
  ageMs: { medianActive: number | null; maxActive: number | null };
}

export class IncidentError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const INCIDENT_PREFIX = 'incident:';
const INCIDENTS_ALL = 'incidents:all';
const INCIDENTS_OPEN = 'incidents:open';
const INCIDENTS_BY_SEVERITY_PREFIX = 'incidents:by-severity:';
const MAX_INCIDENTS = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function newIncidentId(): string {
  return `inc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string { return new Date().toISOString(); }

function isActive(status: IncidentStatus): boolean {
  return (ACTIVE_STATUSES as IncidentStatus[]).includes(status);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function saveIncident(rec: IncidentRecord): Promise<void> {
  const redis = getRedis();
  await redis.set(`${INCIDENT_PREFIX}${rec.id}`, JSON.stringify(rec));
}

export async function getIncident(id: string): Promise<IncidentRecord | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${INCIDENT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as IncidentRecord);
}

export interface ListOptions {
  limit?: number;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  category?: IncidentCategory;
}

async function readIdsFrom(zsetKey: string, limit: number): Promise<string[]> {
  const redis = getRedis();
  const total = await redis.zcard(zsetKey);
  if (total === 0) return [];
  return await redis.zrange(zsetKey, 0, Math.min(total, limit) - 1, { rev: true });
}

async function loadIds(ids: string[]): Promise<IncidentRecord[]> {
  const redis = getRedis();
  const out: IncidentRecord[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${INCIDENT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function listIncidents(opts: ListOptions = {}): Promise<IncidentRecord[]> {
  const limit = opts.limit ?? 200;
  // Pick the most-specific index available
  let ids: string[];
  if (opts.severity) {
    ids = await readIdsFrom(`${INCIDENTS_BY_SEVERITY_PREFIX}${opts.severity}`, limit * 2);
  } else if (opts.status && isActive(opts.status)) {
    ids = await readIdsFrom(INCIDENTS_OPEN, limit * 2);
  } else {
    ids = await readIdsFrom(INCIDENTS_ALL, limit * 2);
  }
  let recs = await loadIds(ids);
  if (opts.status) recs = recs.filter(r => r.status === opts.status);
  if (opts.category) recs = recs.filter(r => r.category === opts.category);
  return recs.slice(0, limit);
}

export async function listOpenIncidents(limit = 200): Promise<IncidentRecord[]> {
  const ids = await readIdsFrom(INCIDENTS_OPEN, limit * 2);
  const recs = await loadIds(ids);
  return recs.filter(r => isActive(r.status)).slice(0, limit);
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateIncidentInput {
  title: string;
  description: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  tags?: string[];
  relatedWagerId?: string;
  relatedOperatorId?: string;
  relatedIntegrityReportId?: string;
  relatedSettlementPreviewId?: string;
  relatedCertificationId?: string;
  relatedRbacReviewId?: string;
  relatedRunbookDate?: string;
  relatedEodReportDate?: string;
  followUpActions?: string[];
  warnings?: string[];
}

export async function createIncident(input: CreateIncidentInput, actor: string): Promise<IncidentRecord> {
  if (!actor) throw new IncidentError('actor is required', 'actor_required');
  if (!input.title?.trim()) throw new IncidentError('title is required', 'title_required');
  if (!input.description?.trim()) throw new IncidentError('description is required', 'description_required');
  if (!INCIDENT_CATEGORIES.includes(input.category)) {
    throw new IncidentError(`Invalid category "${input.category}"`, 'invalid_category');
  }
  if (!INCIDENT_SEVERITIES.includes(input.severity)) {
    throw new IncidentError(`Invalid severity "${input.severity}"`, 'invalid_severity');
  }

  const id = newIncidentId();
  const now = nowIso();

  const rec: IncidentRecord = {
    id,
    createdAt: now,
    createdBy: actor,
    category: input.category,
    severity: input.severity,
    status: 'open',
    title: input.title.trim(),
    description: input.description.trim(),
    relatedWagerId: input.relatedWagerId?.trim() || undefined,
    relatedOperatorId: input.relatedOperatorId?.trim() || undefined,
    relatedIntegrityReportId: input.relatedIntegrityReportId?.trim() || undefined,
    relatedSettlementPreviewId: input.relatedSettlementPreviewId?.trim() || undefined,
    relatedCertificationId: input.relatedCertificationId?.trim() || undefined,
    relatedRbacReviewId: input.relatedRbacReviewId?.trim() || undefined,
    relatedRunbookDate: input.relatedRunbookDate?.trim() || undefined,
    relatedEodReportDate: input.relatedEodReportDate?.trim() || undefined,
    tags: (input.tags ?? []).map(t => t.trim()).filter(Boolean),
    timeline: [{ at: now, actor, action: 'created' }],
    followUpActions: (input.followUpActions ?? []).map(a => a.trim()).filter(Boolean),
    warnings: (input.warnings ?? []).map(w => w.trim()).filter(Boolean),
  };

  await saveIncident(rec);

  const redis = getRedis();
  await redis.zadd(INCIDENTS_ALL, { score: Date.now(), member: id });
  await redis.zadd(INCIDENTS_OPEN, { score: Date.now(), member: id });
  await redis.zadd(`${INCIDENTS_BY_SEVERITY_PREFIX}${input.severity}`, { score: Date.now(), member: id });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'incident_created',
    targetType: 'incident',
    targetId: id,
    summary: `Incident ${id} created (${input.category}/${input.severity}): ${input.title.trim().slice(0, 120)}`,
    details: { id, category: input.category, severity: input.severity },
  });

  return rec;
}

// ── Timeline / status ────────────────────────────────────────────────────────

export async function addTimelineEntry(id: string, note: string, actor: string): Promise<IncidentRecord> {
  if (!actor) throw new IncidentError('actor is required', 'actor_required');
  if (!note?.trim()) throw new IncidentError('note is required', 'note_required');

  const rec = await getIncident(id);
  if (!rec) throw new IncidentError('Incident not found', 'incident_not_found');

  const entry: TimelineEntry = {
    at: nowIso(), actor, action: 'note', note: note.trim(),
  };
  rec.timeline = [...rec.timeline, entry].slice(-500);
  await saveIncident(rec);

  await logAuditEvent({
    actor,
    eventType: 'incident_timeline_entry_added',
    targetType: 'incident',
    targetId: id,
    summary: `Timeline note added to incident ${id}`,
    details: { id, action: 'note' },
  });

  return rec;
}

export async function changeStatus(id: string, to: IncidentStatus, actor: string, note?: string): Promise<IncidentRecord> {
  if (!actor) throw new IncidentError('actor is required', 'actor_required');
  if (!INCIDENT_STATUSES.includes(to)) throw new IncidentError(`Invalid status "${to}"`, 'invalid_status');

  // resolve / close have dedicated functions; use those
  if (to === 'resolved') throw new IncidentError('Use resolveIncident with a resolutionSummary', 'use_resolve_endpoint');
  if (to === 'closed') throw new IncidentError('Use closeIncident', 'use_close_endpoint');

  const rec = await getIncident(id);
  if (!rec) throw new IncidentError('Incident not found', 'incident_not_found');

  const allowed = STATUS_TRANSITIONS[rec.status] ?? [];
  if (!allowed.includes(to)) {
    throw new IncidentError(`Cannot transition from ${rec.status} to ${to}`, 'illegal_transition');
  }

  const from = rec.status;
  const now = nowIso();
  rec.status = to;
  rec.timeline = [...rec.timeline, {
    at: now, actor,
    action: `status_changed:${from}→${to}`,
    note: note?.trim() || undefined,
  }].slice(-500);

  // If reopening (resolved → open), clear resolution stamps so subsequent
  // resolves require a fresh summary
  if (from === 'resolved' && to === 'open') {
    rec.resolutionSummary = undefined;
    rec.resolutionConfirmedAt = undefined;
    rec.resolutionConfirmedBy = undefined;
  }

  await saveIncident(rec);

  // Index maintenance
  const redis = getRedis();
  if (isActive(to) && !isActive(from)) {
    await redis.zadd(INCIDENTS_OPEN, { score: Date.now(), member: id });
  } else if (!isActive(to) && isActive(from)) {
    await redis.zrem(INCIDENTS_OPEN, id);
  }

  await logAuditEvent({
    actor,
    eventType: 'incident_status_changed',
    targetType: 'incident',
    targetId: id,
    summary: `Incident ${id} status: ${from} → ${to}`,
    details: { id, from, to, note: note?.trim() },
  });

  return rec;
}

export async function resolveIncident(id: string, actor: string, resolutionSummary: string): Promise<IncidentRecord> {
  if (!actor) throw new IncidentError('actor is required', 'actor_required');
  if (!resolutionSummary?.trim()) {
    throw new IncidentError('resolutionSummary is required to resolve', 'resolution_required');
  }

  const rec = await getIncident(id);
  if (!rec) throw new IncidentError('Incident not found', 'incident_not_found');

  const allowed = STATUS_TRANSITIONS[rec.status] ?? [];
  if (!allowed.includes('resolved')) {
    throw new IncidentError(`Cannot resolve from status ${rec.status}`, 'illegal_transition');
  }

  const from = rec.status;
  const now = nowIso();
  rec.status = 'resolved';
  rec.resolutionSummary = resolutionSummary.trim();
  rec.resolutionConfirmedAt = now;
  rec.resolutionConfirmedBy = actor;
  rec.timeline = [...rec.timeline, {
    at: now, actor,
    action: `status_changed:${from}→resolved`,
    note: resolutionSummary.trim(),
  }].slice(-500);

  await saveIncident(rec);

  // Remove from open index
  const redis = getRedis();
  await redis.zrem(INCIDENTS_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'incident_resolved',
    targetType: 'incident',
    targetId: id,
    summary: `Incident ${id} resolved: ${resolutionSummary.trim().slice(0, 120)}`,
    details: { id, from, resolutionSummary: resolutionSummary.trim() },
  });

  return rec;
}

export async function closeIncident(id: string, actor: string, note?: string): Promise<IncidentRecord> {
  if (!actor) throw new IncidentError('actor is required', 'actor_required');

  const rec = await getIncident(id);
  if (!rec) throw new IncidentError('Incident not found', 'incident_not_found');
  if (rec.status !== 'resolved') {
    throw new IncidentError('Close requires the incident to be resolved first', 'must_resolve_first');
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

  await saveIncident(rec);

  // resolved → closed: not active in either case, just ensure removal from open index
  const redis = getRedis();
  await redis.zrem(INCIDENTS_OPEN, id);

  await logAuditEvent({
    actor,
    eventType: 'incident_closed',
    targetType: 'incident',
    targetId: id,
    summary: `Incident ${id} closed${note ? `: ${note.trim().slice(0, 120)}` : ''}`,
    details: { id, note: note?.trim() },
  });

  return rec;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export async function getIncidentSummary(): Promise<IncidentSummary> {
  const recs = await listIncidents({ limit: 500 });
  const byStatus: Record<IncidentStatus, number> = { open: 0, investigating: 0, monitoring: 0, resolved: 0, closed: 0 };
  const bySeverity: Record<IncidentSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byCategory: Record<IncidentCategory, number> = {
    market_design: 0, pricing: 0, grading: 0, settlement_preview: 0,
    integrity: 0, operator_governance: 0, system: 0, other: 0,
  };

  let openCount = 0;
  let criticalOpen = 0;
  const activeAges: number[] = [];
  const now = Date.now();

  for (const r of recs) {
    byStatus[r.status]++;
    bySeverity[r.severity]++;
    byCategory[r.category]++;
    if (isActive(r.status)) {
      openCount++;
      if (r.severity === 'critical') criticalOpen++;
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
    byStatus, bySeverity, byCategory,
    openCount, criticalOpen,
    ageMs: { medianActive, maxActive },
  };
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(INCIDENTS_ALL);
  if (total <= MAX_INCIDENTS) return;
  const overflow = total - MAX_INCIDENTS;
  const oldest = await redis.zrange(INCIDENTS_ALL, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(INCIDENTS_ALL, 0, overflow - 1);
    for (const oldId of oldest) {
      await redis.del(`${INCIDENT_PREFIX}${oldId}`);
      await redis.zrem(INCIDENTS_OPEN, oldId);
      for (const sev of INCIDENT_SEVERITIES) {
        await redis.zrem(`${INCIDENTS_BY_SEVERITY_PREFIX}${sev}`, oldId);
      }
    }
  }
}
