// ── Step 110: Unified Audit Investigation Center ───────────────────────────
//
// Read-only timeline reconstruction across every governance subsystem.
// Reads audit events + related objects via existing read-only libs and
// enriches each entry with inferred subsystem + severity. Saves optional
// investigation views with notes. NEVER mutates wagers, balances, RBAC,
// pricing, grading, or settlements. Writes confined to audit-investigation:*
// + audit log.

import { getRedis } from './redis';
import { logAuditEvent, listAuditEvents, type AuditEvent } from './audit-log';
import { listAllWagers, getWager } from './wager-store';
import { getIncident, listIncidents } from './incident-management';
import { getDispute, listDisputes } from './dispute-workflow';
import { getIntegrityReport, listIntegrityReports } from './market-integrity';
import { getSettlementPreview, listSettlementPreviews } from './wager-settlement-preview';
import { getCert, listCertifications } from './operator-certification';
import { getOperatorRbacReview, listOperatorRbacReviews } from './operator-rbac-review';
import { getRunbook, listRunbooks } from './daily-operator-runbook';
import { getEvidence, listEvidence } from './weather-evidence';
import { getChange, listChanges } from './wager-change-control';

// ── Types ────────────────────────────────────────────────────────────────────

export type Subsystem =
  | 'wagers'
  | 'resolution'
  | 'settlement'
  | 'integrity'
  | 'incidents'
  | 'disputes'
  | 'change_control'
  | 'evidence'
  | 'certification'
  | 'rbac_review'
  | 'runbook'
  | 'training'
  | 'playbook'
  | 'reporting'
  | 'user_risk'
  | 'exposure'
  | 'security'
  | 'other';

export type SeverityClass = 'info' | 'warning' | 'critical';

export interface TimelineEntry {
  id: string;            // audit event id
  at: string;            // ISO
  subsystem: Subsystem;
  category: string;      // human-readable subsystem label
  actor?: string;
  eventType: string;
  relatedObjectType?: string;
  relatedObjectId?: string;
  summary: string;
  severity: SeverityClass;
  rawEventReference: AuditEvent;
}

export interface InvestigationFilters {
  from?: string;
  to?: string;
  actor?: string;
  wagerId?: string;
  userId?: string;
  severity?: SeverityClass;
  eventType?: string;     // substring match
  subsystem?: Subsystem;
}

export interface RelatedObjectsBundle {
  wagers: any[];
  incidents: any[];
  disputes: any[];
  integrityReports: any[];
  settlementPreviews: any[];
  certifications: any[];
  rbacReviews: any[];
  runbooks: any[];
  evidence: any[];
  changeRequests: any[];
}

export interface InvestigationView {
  id: string;
  createdAt: string;
  createdBy: string;
  title: string;
  filters: InvestigationFilters;
  savedNotes: string[];
  /** Captured at save-time for reproducibility. */
  timeline: TimelineEntry[];
  /** Captured at save-time. */
  relatedObjects: RelatedObjectsBundle;
}

export class AuditInvestigationError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const VIEW_PREFIX = 'audit-investigation:';
const VIEWS_SET = 'audit-investigations:all';
const MAX_VIEWS = 500;

// ── Subsystem + severity inference ──────────────────────────────────────────

interface EventClassification {
  subsystem: Subsystem;
  category: string;
  severity: SeverityClass;
}

function classify(e: AuditEvent): EventClassification {
  const t = e.eventType ?? '';

  // Subsystem via prefix matching, ordered most-specific first
  let subsystem: Subsystem = 'other';
  let category = 'Other';

  if (t.startsWith('wager_resolution_preview_generated') || t === 'wager_manually_graded' || t === 'wager_manually_voided') {
    subsystem = 'resolution'; category = 'Wager resolution';
  } else if (t.startsWith('wager_settlement_preview_')) {
    subsystem = 'settlement'; category = 'Settlement preview';
  } else if (t.startsWith('wager_change_')) {
    subsystem = 'change_control'; category = 'Change control';
  } else if (t.startsWith('wager_')) {
    subsystem = 'wagers'; category = 'Wagers';
  } else if (t.startsWith('market_integrity_')) {
    subsystem = 'integrity'; category = 'Market integrity';
  } else if (t.startsWith('incident_')) {
    subsystem = 'incidents'; category = 'Incidents';
  } else if (t.startsWith('dispute_')) {
    subsystem = 'disputes'; category = 'Disputes';
  } else if (t.startsWith('weather_evidence_')) {
    subsystem = 'evidence'; category = 'Weather evidence';
  } else if (t.startsWith('operator_certif')) {
    subsystem = 'certification'; category = 'Operator certification';
  } else if (t.startsWith('operator_rbac_review')) {
    subsystem = 'rbac_review'; category = 'RBAC review';
  } else if (t.startsWith('operator_readiness_generated')) {
    subsystem = 'certification'; category = 'Operator certification';
  } else if (t.startsWith('daily_runbook_')) {
    subsystem = 'runbook'; category = 'Daily runbook';
  } else if (t.startsWith('end_of_day_report_')) {
    subsystem = 'reporting'; category = 'End-of-day report';
  } else if (t.startsWith('training_session_')) {
    subsystem = 'training'; category = 'Operator training';
  } else if (t.startsWith('execution_playbook_')) {
    subsystem = 'playbook'; category = 'Execution playbook';
  } else if (t.startsWith('user_risk_report_')) {
    subsystem = 'user_risk'; category = 'User risk';
  } else if (t.startsWith('house_exposure_')) {
    subsystem = 'exposure'; category = 'House exposure';
  } else if (t.startsWith('strategy_brief_') || t.startsWith('scorecard_alert_')) {
    subsystem = 'reporting'; category = 'Strategy brief / alerts';
  } else if (t.startsWith('pilot_decision_') || t.startsWith('pilot_review_')) {
    subsystem = 'reporting'; category = 'Pilot governance';
  }

  // Severity inference (heuristic — caller can override per-event when richer signals exist)
  let severity: SeverityClass = 'info';
  if (t.includes('revoked') || t.includes('breach') || t.includes('critical') || t === 'wager_manually_voided') {
    severity = 'critical';
  } else if (
    t.includes('rejected') || t.includes('voided') || t.includes('expired') ||
    t.includes('warning') || t.includes('alert_') || t.includes('cancelled') ||
    t === 'incident_resolved' || t === 'dispute_resolved'
  ) {
    severity = 'warning';
  }

  // Refine via known critical event types
  const criticalSet = new Set([
    'wager_manually_voided',
    'operator_certification_revoked',
    'incident_status_changed',  // some transitions are critical; we'll generally stay info unless explicit
  ]);
  if (criticalSet.has(t)) severity = 'critical';

  return { subsystem, category, severity };
}

// ── Build timeline ──────────────────────────────────────────────────────────

function eventToTimeline(e: AuditEvent): TimelineEntry {
  const c = classify(e);
  return {
    id: e.id,
    at: e.createdAt,
    subsystem: c.subsystem,
    category: c.category,
    actor: e.actor,
    eventType: e.eventType,
    relatedObjectType: e.targetType,
    relatedObjectId: e.targetId,
    summary: e.summary,
    severity: c.severity,
    rawEventReference: e,
  };
}

function matchesFilters(entry: TimelineEntry, filters: InvestigationFilters): boolean {
  if (filters.from && entry.at < filters.from) return false;
  if (filters.to && entry.at > filters.to) return false;
  if (filters.actor && entry.actor !== filters.actor) return false;
  if (filters.severity && entry.severity !== filters.severity) return false;
  if (filters.subsystem && entry.subsystem !== filters.subsystem) return false;
  if (filters.eventType && !entry.eventType.includes(filters.eventType)) return false;
  if (filters.wagerId) {
    const matchesTarget = entry.relatedObjectType === 'wager' && entry.relatedObjectId === filters.wagerId;
    const matchesDetails = (entry.rawEventReference?.details as any)?.wagerId === filters.wagerId
      || (entry.rawEventReference?.details as any)?.relatedWagerId === filters.wagerId;
    if (!matchesTarget && !matchesDetails) return false;
  }
  if (filters.userId) {
    const matchesTarget = entry.relatedObjectType === 'user' && entry.relatedObjectId === filters.userId;
    const matchesDetails = (entry.rawEventReference?.details as any)?.userId === filters.userId
      || (entry.rawEventReference?.details as any)?.operatorId === filters.userId;
    if (!matchesTarget && !matchesDetails) return false;
  }
  return true;
}

export async function searchTimeline(filters: InvestigationFilters, limit = 500): Promise<TimelineEntry[]> {
  // Pull a wide window from the audit log; the log itself is capped (500) so
  // this is bounded cost.
  const events = await listAuditEvents(500).catch(() => [] as AuditEvent[]);
  const enriched = events.map(eventToTimeline);
  const filtered = enriched.filter(e => matchesFilters(e, filters));
  return filtered.slice(0, limit);
}

// ── Object history ──────────────────────────────────────────────────────────

export type ObjectHistoryKind =
  | 'wager' | 'incident' | 'dispute' | 'integrity' | 'settlement_preview'
  | 'certification' | 'rbac_review' | 'runbook' | 'evidence' | 'change_request' | 'user';

export interface ObjectHistory {
  kind: ObjectHistoryKind;
  id: string;
  object: any | null;
  timeline: TimelineEntry[];
}

export async function objectHistory(kind: ObjectHistoryKind, id: string): Promise<ObjectHistory> {
  if (!id) throw new AuditInvestigationError('id is required', 'id_required');

  // Resolve the object via the appropriate read-only lookup
  let object: any = null;
  try {
    if (kind === 'wager') object = await getWager(id);
    else if (kind === 'incident') object = await getIncident(id);
    else if (kind === 'dispute') object = await getDispute(id);
    else if (kind === 'integrity') object = await getIntegrityReport(id);
    else if (kind === 'settlement_preview') object = await getSettlementPreview(id);
    else if (kind === 'certification') object = await getCert(id);
    else if (kind === 'rbac_review') object = await getOperatorRbacReview(id);
    else if (kind === 'runbook') object = await getRunbook(id);
    else if (kind === 'evidence') object = await getEvidence(id);
    else if (kind === 'change_request') object = await getChange(id);
    // 'user' has no canonical lookup; we just return events targeting that user
  } catch { object = null; }

  // Filter the audit log
  const filters: InvestigationFilters = {};
  if (kind === 'wager') filters.wagerId = id;
  else if (kind === 'user') filters.userId = id;

  // For other kinds, match by targetId == id when targetType matches a sensible value.
  const events = await listAuditEvents(500).catch(() => [] as AuditEvent[]);
  const enriched = events.map(eventToTimeline);

  const targetTypeMap: Partial<Record<ObjectHistoryKind, string>> = {
    incident: 'incident',
    dispute: 'dispute',
    integrity: 'wager',                   // integrity reports target a wager
    settlement_preview: 'wager',          // settlement preview targets a wager
    certification: 'operator',
    rbac_review: 'operator',
    runbook: 'daily_runbook',
    evidence: 'weather_evidence',
    change_request: 'wager_change_request',
  };

  const timeline = enriched.filter(e => {
    if (kind === 'wager') return matchesFilters(e, filters);
    if (kind === 'user') return matchesFilters(e, filters);
    // Match by targetId === id AND specific subsystems
    const tt = targetTypeMap[kind];
    if (tt && e.relatedObjectType === tt && e.relatedObjectId === id) return true;
    // Or match by details.id / details.{kind}Id in the raw payload
    const d = e.rawEventReference?.details as any;
    if (d && (d.id === id || d.reportId === id || d.previewId === id || d.certId === id || d.reviewId === id || d.recId === id || d.runId === id)) return true;
    return false;
  });

  return { kind, id, object, timeline };
}

// ── Related objects bundle (for Cross-System tab) ───────────────────────────

export async function buildRelatedObjects(filters: InvestigationFilters): Promise<RelatedObjectsBundle> {
  const out: RelatedObjectsBundle = {
    wagers: [], incidents: [], disputes: [], integrityReports: [], settlementPreviews: [],
    certifications: [], rbacReviews: [], runbooks: [], evidence: [], changeRequests: [],
  };

  // Pull a sample from each subsystem (read-only). Failures degrade silently — this is for
  // navigation, not authoritative data.
  const [
    wagers, incidents, disputes, integrity, previews, certs, rbac, runbooks, evidence, changes,
  ] = await Promise.all([
    listAllWagers(50).catch(() => []),
    listIncidents({ limit: 50 }).catch(() => []),
    listDisputes({ limit: 50 }).catch(() => []),
    listIntegrityReports(50).catch(() => []),
    listSettlementPreviews(50).catch(() => []),
    listCertifications(50).catch(() => []),
    listOperatorRbacReviews(50).catch(() => []),
    listRunbooks(30).catch(() => []),
    listEvidence(50).catch(() => []),
    listChanges({ limit: 50 }).catch(() => []),
  ]);

  out.wagers = wagers;
  out.incidents = incidents;
  out.disputes = disputes;
  out.integrityReports = integrity;
  out.settlementPreviews = previews;
  out.certifications = certs;
  out.rbacReviews = rbac;
  out.runbooks = runbooks;
  out.evidence = evidence;
  out.changeRequests = changes;
  return out;
}

// ── Saved investigation views ───────────────────────────────────────────────

export interface SaveInvestigationInput {
  title: string;
  filters: InvestigationFilters;
  /** Optional pre-captured timeline; otherwise we compute it now. */
  timeline?: TimelineEntry[];
  /** Optional initial notes. */
  notes?: string[];
}

function newViewId(): string {
  return `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function saveView(view: InvestigationView): Promise<void> {
  const redis = getRedis();
  await redis.set(`${VIEW_PREFIX}${view.id}`, JSON.stringify(view));
}

export async function saveInvestigation(input: SaveInvestigationInput, actor: string): Promise<InvestigationView> {
  if (!actor) throw new AuditInvestigationError('actor is required', 'actor_required');
  if (!input.title?.trim()) throw new AuditInvestigationError('title is required', 'title_required');

  const filters = input.filters ?? {};
  const timeline = input.timeline ?? await searchTimeline(filters, 500);
  const relatedObjects = await buildRelatedObjects(filters);

  const id = newViewId();
  const now = new Date().toISOString();
  const view: InvestigationView = {
    id,
    createdAt: now,
    createdBy: actor,
    title: input.title.trim(),
    filters,
    savedNotes: (input.notes ?? []).map(n => `[${now}] ${actor}: ${n.trim()}`).filter(Boolean),
    timeline,
    relatedObjects,
  };

  await saveView(view);
  const redis = getRedis();
  await redis.zadd(VIEWS_SET, { score: Date.now(), member: id });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'audit_investigation_saved',
    targetType: 'audit_investigation',
    targetId: id,
    summary: `Investigation view ${id} saved: ${input.title.trim().slice(0, 120)}`,
    details: { id, filters, eventCount: timeline.length },
  });

  return view;
}

export async function getInvestigation(id: string): Promise<InvestigationView | null> {
  if (!id) return null;
  const redis = getRedis();
  const raw = await redis.get(`${VIEW_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as InvestigationView);
}

export async function listInvestigations(limit = 100): Promise<InvestigationView[]> {
  const redis = getRedis();
  const total = await redis.zcard(VIEWS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(VIEWS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: InvestigationView[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${VIEW_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function addInvestigationNote(id: string, note: string, actor: string): Promise<InvestigationView> {
  if (!actor) throw new AuditInvestigationError('actor is required', 'actor_required');
  if (!note?.trim()) throw new AuditInvestigationError('note is required', 'note_required');

  const view = await getInvestigation(id);
  if (!view) throw new AuditInvestigationError('Investigation not found', 'investigation_not_found');

  const stamped = `[${new Date().toISOString()}] ${actor}: ${note.trim()}`;
  view.savedNotes = [...(view.savedNotes ?? []), stamped].slice(-500);
  await saveView(view);

  await logAuditEvent({
    actor,
    eventType: 'audit_investigation_note_added',
    targetType: 'audit_investigation',
    targetId: id,
    summary: `Note added to investigation ${id}`,
    details: { id },
  });

  return view;
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(VIEWS_SET);
  if (total <= MAX_VIEWS) return;
  const overflow = total - MAX_VIEWS;
  const oldest = await redis.zrange(VIEWS_SET, 0, overflow - 1) as string[];
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(VIEWS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${VIEW_PREFIX}${oldId}`);
  }
}
