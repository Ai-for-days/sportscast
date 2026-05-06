// ── Step 112: Admin Notification Inbox ──────────────────────────────────────
//
// Internal admin-only inbox of advisory alerts gathered from existing
// read-only summaries. NEVER sends external notifications (email / SMS /
// push), auto-resolves issues, mutates wagers / balances / RBAC, or grades
// markets. Writes confined to admin-notification:* keys plus audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getLatestSnapshot as getLatestOpsHealthSnapshot } from './operational-health';
import { getIncidentSummary, listOpenIncidents } from './incident-management';
import { getDisputeSummary, listOpenDisputes } from './dispute-workflow';
import { getIntegritySummary, listIntegrityReports } from './market-integrity';
import { listSnapshots as listExposureSnapshots } from './house-exposure';
import { listSettlementPreviews, listGradedWagersForSettlementPreview } from './wager-settlement-preview';
import { buildCertSummary } from './operator-certification';
import { getOperatorRbacReviewSummary, listOperatorRbacReviews } from './operator-rbac-review';
import { listRunbooks } from './daily-operator-runbook';
import { getEvidenceSummary, listEvidence } from './weather-evidence';
import { listChanges } from './wager-change-control';

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationSource =
  | 'operational_health'
  | 'incident'
  | 'dispute'
  | 'market_integrity'
  | 'house_exposure'
  | 'settlement_preview'
  | 'operator_certification'
  | 'rbac_review'
  | 'daily_runbook'
  | 'weather_evidence'
  | 'change_control'
  | 'system';

export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationStatus = 'unread' | 'read' | 'acknowledged' | 'dismissed';

export interface NotificationNote {
  at: string;
  actor: string;
  text: string;
}

export interface AdminNotification {
  id: string;
  createdAt: string;
  source: NotificationSource;
  severity: NotificationSeverity;
  status: NotificationStatus;
  title: string;
  message: string;
  relatedObjectType?: string;
  relatedObjectId?: string;
  link?: string;
  createdBySystem: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  dismissedAt?: string;
  dismissedBy?: string;
  notes: NotificationNote[];
}

export interface InboxSummary {
  total: number;
  unread: number;
  bySeverity: Record<NotificationSeverity, number>;
  bySource: Record<NotificationSource, number>;
  criticalUnread: number;
  warningUnread: number;
  acknowledged: number;
  dismissed: number;
}

export interface DigestResult {
  generatedAt: string;
  generatedBy: string;
  created: AdminNotification[];
  skippedDuplicates: number;
  inspectedSources: number;
  errors: { source: NotificationSource; error: string }[];
}

export class InboxError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ─────────────────────────────────────────────────────

const KEY_PREFIX = 'admin-notification:';
const ALL_SET = 'admin-notifications:all';
const UNREAD_SET = 'admin-notifications:unread';
const BY_SOURCE_PREFIX = 'admin-notifications:by-source:';
const BY_SEVERITY_PREFIX = 'admin-notifications:by-severity:';
const MAX_NOTIFICATIONS = 1000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function newId(): string {
  return `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }

function stableKey(source: NotificationSource, relatedId: string | undefined, title: string): string {
  return `${source}::${relatedId ?? '-'}::${title}`;
}

async function readIds(setKey: string, limit: number): Promise<string[]> {
  const redis = getRedis();
  const ids = await redis.zrange(setKey, 0, -1, { rev: true });
  if (!ids) return [];
  return (ids as string[]).slice(0, limit);
}

async function loadOne(id: string): Promise<AdminNotification | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as AdminNotification;
}

async function loadIds(ids: string[]): Promise<AdminNotification[]> {
  const out: AdminNotification[] = [];
  for (const id of ids) {
    const n = await loadOne(id);
    if (n) out.push(n);
  }
  return out;
}

async function saveNotification(n: AdminNotification): Promise<void> {
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${n.id}`, JSON.stringify(n));
}

async function indexNotification(n: AdminNotification): Promise<void> {
  const redis = getRedis();
  const score = Date.parse(n.createdAt);
  await redis.zadd(ALL_SET, { score, member: n.id });
  await redis.zadd(`${BY_SOURCE_PREFIX}${n.source}`, { score, member: n.id });
  await redis.zadd(`${BY_SEVERITY_PREFIX}${n.severity}`, { score, member: n.id });
  if (n.status === 'unread') {
    await redis.zadd(UNREAD_SET, { score, member: n.id });
  }
  // Trim cap on the all-set, dropping oldest from all indices.
  const count = await redis.zcard(ALL_SET);
  if (count > MAX_NOTIFICATIONS) {
    const overflow = count - MAX_NOTIFICATIONS;
    const oldest = await redis.zrange(ALL_SET, 0, overflow - 1);
    for (const oid of oldest as string[]) {
      const old = await loadOne(oid);
      if (old) {
        await redis.zrem(`${BY_SOURCE_PREFIX}${old.source}`, oid);
        await redis.zrem(`${BY_SEVERITY_PREFIX}${old.severity}`, oid);
      }
      await redis.zrem(UNREAD_SET, oid);
      await redis.del(`${KEY_PREFIX}${oid}`);
    }
    await redis.zremrangebyrank(ALL_SET, 0, overflow - 1);
  }
}

// Active = unread / read / acknowledged. Dismissed is NOT active.
function isActive(n: AdminNotification): boolean {
  return n.status !== 'dismissed';
}

async function findActiveDuplicate(source: NotificationSource, relatedId: string | undefined, title: string): Promise<AdminNotification | null> {
  // Cheaper: scan recent by-source set
  const ids = await readIds(`${BY_SOURCE_PREFIX}${source}`, 200);
  const target = stableKey(source, relatedId, title);
  for (const id of ids) {
    const n = await loadOne(id);
    if (!n) continue;
    if (!isActive(n)) continue;
    if (stableKey(n.source, n.relatedObjectId, n.title) === target) return n;
  }
  return null;
}

// ── Internal create ─────────────────────────────────────────────────────────

interface CreateInput {
  source: NotificationSource;
  severity: NotificationSeverity;
  title: string;
  message: string;
  relatedObjectType?: string;
  relatedObjectId?: string;
  link?: string;
}

async function createNotification(input: CreateInput, actor: string): Promise<{ created: AdminNotification | null; skipped: boolean }> {
  const existing = await findActiveDuplicate(input.source, input.relatedObjectId, input.title);
  if (existing) return { created: null, skipped: true };

  const n: AdminNotification = {
    id: newId(),
    createdAt: nowIso(),
    source: input.source,
    severity: input.severity,
    status: 'unread',
    title: input.title,
    message: input.message,
    relatedObjectType: input.relatedObjectType,
    relatedObjectId: input.relatedObjectId,
    link: input.link,
    createdBySystem: true,
    notes: [],
  };
  await saveNotification(n);
  await indexNotification(n);
  return { created: n, skipped: false };
}

// ── Read API ────────────────────────────────────────────────────────────────

export interface ListOptions {
  status?: NotificationStatus;
  source?: NotificationSource;
  severity?: NotificationSeverity;
  limit?: number;
}

export async function listNotifications(opts: ListOptions = {}): Promise<AdminNotification[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const setKey =
    opts.source ? `${BY_SOURCE_PREFIX}${opts.source}`
      : opts.severity ? `${BY_SEVERITY_PREFIX}${opts.severity}`
      : opts.status === 'unread' ? UNREAD_SET
      : ALL_SET;
  const ids = await readIds(setKey, limit * 2);
  let recs = await loadIds(ids);
  if (opts.status) recs = recs.filter(r => r.status === opts.status);
  if (opts.severity) recs = recs.filter(r => r.severity === opts.severity);
  if (opts.source) recs = recs.filter(r => r.source === opts.source);
  return recs.slice(0, limit);
}

export async function listUnread(limit = 200): Promise<AdminNotification[]> {
  return listNotifications({ status: 'unread', limit });
}

export async function getNotification(id: string): Promise<AdminNotification | null> {
  return loadOne(id);
}

export async function getInboxSummary(): Promise<InboxSummary> {
  const recs = await listNotifications({ limit: 500 });
  const bySeverity: Record<NotificationSeverity, number> = { info: 0, warning: 0, critical: 0 };
  const bySource: Record<NotificationSource, number> = {
    operational_health: 0, incident: 0, dispute: 0, market_integrity: 0,
    house_exposure: 0, settlement_preview: 0, operator_certification: 0,
    rbac_review: 0, daily_runbook: 0, weather_evidence: 0,
    change_control: 0, system: 0,
  };
  let unread = 0, ack = 0, dismissed = 0, criticalUnread = 0, warningUnread = 0;
  for (const r of recs) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (r.status === 'unread') {
      unread++;
      if (r.severity === 'critical') criticalUnread++;
      if (r.severity === 'warning') warningUnread++;
    }
    if (r.status === 'acknowledged') ack++;
    if (r.status === 'dismissed') dismissed++;
  }
  return { total: recs.length, unread, bySeverity, bySource, criticalUnread, warningUnread, acknowledged: ack, dismissed };
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function markRead(id: string, actor: string): Promise<AdminNotification> {
  if (!actor) throw new InboxError('actor is required', 'actor_required');
  const n = await loadOne(id);
  if (!n) throw new InboxError(`Notification ${id} not found`, 'not_found');
  if (n.status === 'dismissed') throw new InboxError('Notification is dismissed', 'invalid_state');
  if (n.status === 'unread') {
    n.status = 'read';
    await saveNotification(n);
    const redis = getRedis();
    await redis.zrem(UNREAD_SET, id);
    await logAuditEvent({
      actor,
      eventType: 'admin_notification_marked_read',
      targetType: 'admin_notification',
      targetId: id,
      summary: `Notification ${id} marked read by ${actor}.`,
      details: { id, source: n.source, severity: n.severity },
    });
  }
  return n;
}

export async function acknowledge(id: string, actor: string, note?: string): Promise<AdminNotification> {
  if (!actor) throw new InboxError('actor is required', 'actor_required');
  const n = await loadOne(id);
  if (!n) throw new InboxError(`Notification ${id} not found`, 'not_found');
  if (n.status === 'dismissed') throw new InboxError('Notification is dismissed', 'invalid_state');
  n.status = 'acknowledged';
  n.acknowledgedAt = nowIso();
  n.acknowledgedBy = actor;
  if (note?.trim()) n.notes.push({ at: nowIso(), actor, text: note.trim() });
  await saveNotification(n);
  const redis = getRedis();
  await redis.zrem(UNREAD_SET, id);
  await logAuditEvent({
    actor,
    eventType: 'admin_notification_acknowledged',
    targetType: 'admin_notification',
    targetId: id,
    summary: `Notification ${id} acknowledged by ${actor}.`,
    details: { id, source: n.source, severity: n.severity },
  });
  return n;
}

export async function dismiss(id: string, actor: string, note?: string): Promise<AdminNotification> {
  if (!actor) throw new InboxError('actor is required', 'actor_required');
  const n = await loadOne(id);
  if (!n) throw new InboxError(`Notification ${id} not found`, 'not_found');
  n.status = 'dismissed';
  n.dismissedAt = nowIso();
  n.dismissedBy = actor;
  if (note?.trim()) n.notes.push({ at: nowIso(), actor, text: note.trim() });
  await saveNotification(n);
  const redis = getRedis();
  await redis.zrem(UNREAD_SET, id);
  await logAuditEvent({
    actor,
    eventType: 'admin_notification_dismissed',
    targetType: 'admin_notification',
    targetId: id,
    summary: `Notification ${id} dismissed by ${actor}.`,
    details: { id, source: n.source, severity: n.severity, hasNote: !!note?.trim() },
  });
  return n;
}

export async function addNote(id: string, note: string, actor: string): Promise<AdminNotification> {
  if (!actor) throw new InboxError('actor is required', 'actor_required');
  if (!note?.trim()) throw new InboxError('note is required', 'note_required');
  const n = await loadOne(id);
  if (!n) throw new InboxError(`Notification ${id} not found`, 'not_found');
  n.notes.push({ at: nowIso(), actor, text: note.trim() });
  await saveNotification(n);
  await logAuditEvent({
    actor,
    eventType: 'admin_notification_note_added',
    targetType: 'admin_notification',
    targetId: id,
    summary: `Note added to notification ${id} by ${actor}.`,
    details: { id, source: n.source, severity: n.severity },
  });
  return n;
}

// ── Digest ──────────────────────────────────────────────────────────────────

export async function generateDigest(actor: string): Promise<DigestResult> {
  if (!actor) throw new InboxError('actor is required', 'actor_required');

  const created: AdminNotification[] = [];
  let skippedDuplicates = 0;
  let inspectedSources = 0;
  const errors: { source: NotificationSource; error: string }[] = [];

  async function add(input: CreateInput) {
    const r = await createNotification(input, actor);
    if (r.created) created.push(r.created);
    else if (r.skipped) skippedDuplicates++;
  }

  // 1. Operational health — read latest snapshot only (do NOT regenerate)
  inspectedSources++;
  try {
    const snap = await getLatestOpsHealthSnapshot();
    if (snap) {
      if (snap.severity === 'critical' || snap.severity === 'degraded') {
        await add({
          source: 'operational_health',
          severity: snap.severity === 'critical' ? 'critical' : 'warning',
          title: `Operational health: ${snap.severity}`,
          message: `Latest operational-health snapshot is ${snap.severity}. ${snap.warnings?.[0] ?? ''}`,
          relatedObjectType: 'operational_health_snapshot',
          relatedObjectId: snap.id,
          link: '/admin/system/operational-health',
        });
      }
      if (snap.redisHealth?.status === 'unavailable') {
        await add({
          source: 'operational_health',
          severity: 'critical',
          title: 'Redis probe unavailable',
          message: snap.redisHealth.warning ?? 'Redis probe failed.',
          relatedObjectType: 'operational_health_snapshot',
          relatedObjectId: snap.id,
          link: '/admin/system/operational-health',
        });
      }
    }
  } catch (err: any) { errors.push({ source: 'operational_health', error: err?.message ?? String(err) }); }

  // 2. Incidents — open critical
  inspectedSources++;
  try {
    const sum = await getIncidentSummary();
    if (sum.criticalOpen > 0) {
      const open = await listOpenIncidents(50);
      const criticals = open.filter(i => i.severity === 'critical');
      for (const i of criticals.slice(0, 20)) {
        await add({
          source: 'incident',
          severity: 'critical',
          title: `Critical incident: ${i.title}`,
          message: i.description?.slice(0, 240) ?? '',
          relatedObjectType: 'incident',
          relatedObjectId: i.id,
          link: '/admin/system/incident-management',
        });
      }
    }
  } catch (err: any) { errors.push({ source: 'incident', error: err?.message ?? String(err) }); }

  // 3. Disputes — high / critical open
  inspectedSources++;
  try {
    const sum = await getDisputeSummary();
    if (sum.criticalOpen > 0 || sum.openCount > 0) {
      const open = await listOpenDisputes(50);
      for (const d of open) {
        if (d.severity === 'critical' || d.severity === 'high') {
          await add({
            source: 'dispute',
            severity: d.severity === 'critical' ? 'critical' : 'warning',
            title: `${d.severity.toUpperCase()} dispute: ${d.title ?? d.id}`,
            message: d.description?.slice(0, 240) ?? '',
            relatedObjectType: 'dispute',
            relatedObjectId: d.id,
            link: '/admin/system/dispute-workflow',
          });
        }
      }
    }
  } catch (err: any) { errors.push({ source: 'dispute', error: err?.message ?? String(err) }); }

  // 4. Market integrity — elevated_risk reports
  inspectedSources++;
  try {
    const sum = await getIntegritySummary();
    if (sum.byVerdict.elevated_risk > 0 || sum.bySeverity.critical > 0) {
      const reports = await listIntegrityReports(50);
      for (const r of reports) {
        if (r.verdict === 'elevated_risk' || r.severity === 'critical') {
          await add({
            source: 'market_integrity',
            severity: r.severity === 'critical' ? 'critical' : 'warning',
            title: `Integrity ${r.verdict}: wager ${r.wagerTicketNumber ?? r.wagerId}`,
            message: `Score ${r.integrityScore}. Severity ${r.severity}.`,
            relatedObjectType: 'integrity_report',
            relatedObjectId: r.id,
            link: '/admin/system/market-integrity',
          });
        }
      }
    }
  } catch (err: any) { errors.push({ source: 'market_integrity', error: err?.message ?? String(err) }); }

  // 5. House exposure — latest snapshot warnings
  inspectedSources++;
  try {
    const snaps = await listExposureSnapshots(5);
    const latest = snaps[0];
    if (latest && (latest.warnings?.length ?? 0) > 0) {
      await add({
        source: 'house_exposure',
        severity: latest.projectedNetHouseResult <= -50_000 ? 'warning' : 'info',
        title: `House exposure warnings (${latest.warnings.length})`,
        message: latest.warnings.slice(0, 2).join(' · '),
        relatedObjectType: 'house_exposure_snapshot',
        relatedObjectId: latest.id,
        link: '/admin/system/house-exposure',
      });
    }
  } catch (err: any) { errors.push({ source: 'house_exposure', error: err?.message ?? String(err) }); }

  // 6. Settlement preview — graded markets without preview
  inspectedSources++;
  try {
    const [graded, previews] = await Promise.all([
      listGradedWagersForSettlementPreview(500),
      listSettlementPreviews(500),
    ]);
    const previewedIds = new Set(previews.map(p => p.wagerId));
    const pending = graded.filter(w => !previewedIds.has(w.id));
    if (pending.length > 0) {
      await add({
        source: 'settlement_preview',
        severity: pending.length >= 5 ? 'warning' : 'info',
        title: `${pending.length} graded market(s) lack a settlement preview`,
        message: `${pending.slice(0, 3).map(w => w.ticketNumber ?? w.id).join(', ')}${pending.length > 3 ? '…' : ''}`,
        relatedObjectType: 'settlement_preview_backlog',
        relatedObjectId: 'pending',
        link: '/admin/system/wager-settlement-preview',
      });
    }
  } catch (err: any) { errors.push({ source: 'settlement_preview', error: err?.message ?? String(err) }); }

  // 7. Operator certification — expiring / expired
  inspectedSources++;
  try {
    const { summary, certifications } = await buildCertSummary();
    if ((summary.expiringSoonCount ?? 0) > 0) {
      await add({
        source: 'operator_certification',
        severity: 'warning',
        title: `${summary.expiringSoonCount} certification(s) expire within 30 days`,
        message: 'Schedule re-certification for the affected operators.',
        relatedObjectType: 'certification_summary',
        relatedObjectId: 'expiring',
        link: '/admin/system/operator-certification',
      });
    }
    const expired = certifications.filter(c => c.status === 'expired');
    for (const c of expired.slice(0, 10)) {
      await add({
        source: 'operator_certification',
        severity: 'warning',
        title: `Expired certification: ${c.operatorId}`,
        message: `Certification ${c.id} is expired.`,
        relatedObjectType: 'certification',
        relatedObjectId: c.id,
        link: '/admin/system/operator-certification',
      });
    }
  } catch (err: any) { errors.push({ source: 'operator_certification', error: err?.message ?? String(err) }); }

  // 8. RBAC review — critical / warning
  inspectedSources++;
  try {
    const sum = await getOperatorRbacReviewSummary();
    if (sum.bySeverity.critical > 0 || sum.bySeverity.warning > 0) {
      const reviews = await listOperatorRbacReviews(50);
      for (const r of reviews) {
        if (r.severity === 'critical' || r.severity === 'warning') {
          await add({
            source: 'rbac_review',
            severity: r.severity === 'critical' ? 'critical' : 'warning',
            title: `RBAC ${r.severity}: ${r.operatorId}`,
            message: `${r.recommendation}. ${(r.reasons ?? []).slice(0, 2).join(' · ')}`,
            relatedObjectType: 'rbac_review',
            relatedObjectId: r.id,
            link: '/admin/system/operator-rbac-review',
          });
        }
      }
    }
  } catch (err: any) { errors.push({ source: 'rbac_review', error: err?.message ?? String(err) }); }

  // 9. Daily runbook — incomplete / missing today
  inspectedSources++;
  try {
    const runbooks = await listRunbooks(7);
    const today = new Date().toISOString().slice(0, 10);
    const todayRb = runbooks.find(r => r.date === today);
    if (!todayRb) {
      await add({
        source: 'daily_runbook',
        severity: 'info',
        title: `No runbook for today (${today})`,
        message: 'Daily runbook has not been opened. Cadence is recordkeeping-only but should be run each operating day.',
        relatedObjectType: 'daily_runbook',
        relatedObjectId: today,
        link: '/admin/system/daily-operator-runbook',
      });
    } else if (todayRb.status === 'open') {
      await add({
        source: 'daily_runbook',
        severity: 'info',
        title: `Today's runbook is incomplete`,
        message: `Runbook ${today} is open. Finish checklist items before end of day.`,
        relatedObjectType: 'daily_runbook',
        relatedObjectId: today,
        link: '/admin/system/daily-operator-runbook',
      });
    }
  } catch (err: any) { errors.push({ source: 'daily_runbook', error: err?.message ?? String(err) }); }

  // 10. Weather evidence — conflicts / insufficient
  inspectedSources++;
  try {
    const sum = await getEvidenceSummary();
    if ((sum.byVerdict.conflict_requires_review ?? 0) > 0) {
      const list = await listEvidence(50);
      const conflicts = list.filter(e => e.verdict === 'conflict_requires_review');
      for (const e of conflicts.slice(0, 10)) {
        await add({
          source: 'weather_evidence',
          severity: 'warning',
          title: `Weather evidence conflict: ${e.id}`,
          message: `Multi-source observation conflict requires review.`,
          relatedObjectType: 'weather_evidence',
          relatedObjectId: e.id,
          link: '/admin/system/weather-evidence',
        });
      }
    }
  } catch (err: any) { errors.push({ source: 'weather_evidence', error: err?.message ?? String(err) }); }

  // 11. Change control — approved but not implemented
  inspectedSources++;
  try {
    const approved = await listChanges({ status: 'approved', limit: 200 });
    for (const c of approved) {
      if (!c.implementedAt) {
        await add({
          source: 'change_control',
          severity: c.severity === 'critical' ? 'critical' : c.severity === 'high' ? 'warning' : 'info',
          title: `Approved change awaiting implementation: ${c.id}`,
          message: c.requestedChangeSummary?.slice(0, 240) ?? '',
          relatedObjectType: 'change_request',
          relatedObjectId: c.id,
          link: '/admin/system/wager-change-control',
        });
      }
    }
  } catch (err: any) { errors.push({ source: 'change_control', error: err?.message ?? String(err) }); }

  await logAuditEvent({
    actor,
    eventType: 'admin_notification_digest_generated',
    targetType: 'admin_notification_digest',
    summary: `Inbox digest by ${actor}: ${created.length} new, ${skippedDuplicates} skipped duplicates, ${errors.length} source error(s).`,
    details: {
      created: created.length,
      skippedDuplicates,
      inspectedSources,
      errors: errors.length,
    },
  });

  return {
    generatedAt: nowIso(),
    generatedBy: actor,
    created,
    skippedDuplicates,
    inspectedSources,
    errors,
  };
}
