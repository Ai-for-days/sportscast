// ── Step 111: Operational Health & Reliability Center ─────────────────────────
//
// Read-only aggregation across the platform's existing read-only summary /
// list functions. Detects stale data, workflow backlogs, subsystem failures,
// and Redis latency. Persists snapshots only — never restarts services,
// grades wagers, settles balances, modifies pricing, mutates RBAC, or
// triggers automated remediation. Writes confined to operational-health:*
// keys plus audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { listAllWagers } from './wager-store';
import { getIncidentSummary } from './incident-management';
import { getDisputeSummary } from './dispute-workflow';
import { getIntegritySummary, listIntegrityReports } from './market-integrity';
import { listSettlementPreviews, listGradedWagersForSettlementPreview } from './wager-settlement-preview';
import { buildCertSummary } from './operator-certification';
import { getOperatorRbacReviewSummary } from './operator-rbac-review';
import { getEvidenceSummary } from './weather-evidence';
import { getChangeSummary } from './wager-change-control';
import { listInvestigations } from './audit-investigation';
import { listRunbooks } from './daily-operator-runbook';
import { listSnapshots as listExposureSnapshots } from './house-exposure';
import type { Wager } from './wager-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type Severity = 'healthy' | 'monitor' | 'degraded' | 'critical';

export type Subsystem =
  | 'wagers'
  | 'pricing'
  | 'integrity'
  | 'settlement_preview'
  | 'disputes'
  | 'incidents'
  | 'weather_evidence'
  | 'certifications'
  | 'rbac_reviews'
  | 'audit_investigation'
  | 'runbooks'
  | 'exposure';

export interface SubsystemStatus {
  status: Severity;
  note: string;
  metrics?: Record<string, number | string | null>;
}

export interface StaleDataWarning {
  subsystem: Subsystem;
  detail: string;
  /** Optional age in milliseconds, when applicable. */
  ageMs?: number;
}

export interface BacklogWarning {
  subsystem: Subsystem;
  detail: string;
  count: number;
}

export interface ApiFailure {
  subsystem: Subsystem;
  error: string;
}

export interface RedisHealth {
  status: 'ok' | 'degraded' | 'unavailable';
  latencyEstimateMs?: number;
  warning?: string;
}

export interface OperationalMetrics {
  unresolvedIncidents: number;
  unresolvedDisputes: number;
  overdueRunbooks: number;
  unresolvedIntegrityWarnings: number;
  staleMarkets: number;
  pendingSettlementPreviews: number;
}

export interface HealthSnapshot {
  id: string;
  generatedAt: string;
  generatedBy: string;
  subsystemStatus: Record<Subsystem, SubsystemStatus>;
  staleDataWarnings: StaleDataWarning[];
  backlogWarnings: BacklogWarning[];
  apiFailures: ApiFailure[];
  redisHealth: RedisHealth;
  operationalMetrics: OperationalMetrics;
  warnings: string[];
  recommendations: string[];
  severity: Severity;
}

export interface OperationalHealthSummary {
  totalSnapshots: number;
  latestSnapshot: HealthSnapshot | null;
  severityCounts: Record<Severity, number>;
}

export class OperationalHealthError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const SNAPSHOT_PREFIX = 'operational-health:';
const SNAPSHOTS_SET = 'operational-health-snapshots:all';
const LATEST_KEY = 'operational-health:latest';
const HEALTH_PROBE_KEY = 'operational-health:probe';
const MAX_SNAPSHOTS = 500;

// ── Thresholds ───────────────────────────────────────────────────────────────

const STALE_MARKET_HOURS = 24;                 // unresolved beyond targetDate by this much → stale
const STALE_INTEGRITY_DAYS = 7;                // latest integrity report older than this → stale
const STALE_RUNBOOK_DAYS = 2;                  // no runbook within last N days → stale
const REDIS_DEGRADED_LATENCY_MS = 400;
const REDIS_CRITICAL_LATENCY_MS = 1500;

// ── Helpers ──────────────────────────────────────────────────────────────────

function newSnapshotId(): string {
  return `ophealth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }

function severityRank(s: Severity): number {
  return s === 'critical' ? 3 : s === 'degraded' ? 2 : s === 'monitor' ? 1 : 0;
}
function worse(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}
function rollupSeverity(values: Severity[]): Severity {
  let result: Severity = 'healthy';
  for (const v of values) result = worse(result, v);
  return result;
}

function dayDiff(fromIso: string | undefined, to = Date.now()): number | null {
  if (!fromIso) return null;
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((to - t) / (24 * 60 * 60 * 1000)));
}

function isPastTargetDate(w: Wager, hoursPast: number): boolean {
  if (!w.targetDate) return false;
  // targetDate is a YYYY-MM-DD; treat the end of that calendar day as the deadline.
  const t = Date.parse(`${w.targetDate}T23:59:59Z`);
  if (Number.isNaN(t)) return false;
  return Date.now() - t >= hoursPast * 60 * 60 * 1000;
}

// ── Redis health probe ──────────────────────────────────────────────────────

async function probeRedis(): Promise<RedisHealth> {
  try {
    const redis = getRedis();
    const start = Date.now();
    await redis.set(HEALTH_PROBE_KEY, nowIso(), { ex: 60 });
    await redis.get(HEALTH_PROBE_KEY);
    const latency = Date.now() - start;
    if (latency >= REDIS_CRITICAL_LATENCY_MS) {
      return { status: 'degraded', latencyEstimateMs: latency, warning: `Redis round-trip ${latency}ms — very high.` };
    }
    if (latency >= REDIS_DEGRADED_LATENCY_MS) {
      return { status: 'degraded', latencyEstimateMs: latency, warning: `Redis round-trip ${latency}ms — elevated.` };
    }
    return { status: 'ok', latencyEstimateMs: latency };
  } catch (err: any) {
    return { status: 'unavailable', warning: err?.message ?? 'Redis probe failed.' };
  }
}

// ── Generate ─────────────────────────────────────────────────────────────────

export async function generateSnapshot(actor: string): Promise<HealthSnapshot> {
  if (!actor) throw new OperationalHealthError('actor is required', 'actor_required');

  const apiFailures: ApiFailure[] = [];
  const staleDataWarnings: StaleDataWarning[] = [];
  const backlogWarnings: BacklogWarning[] = [];
  const subsystemStatus: Record<Subsystem, SubsystemStatus> = {
    wagers: { status: 'healthy', note: 'No data loaded yet.' },
    pricing: { status: 'healthy', note: 'No data loaded yet.' },
    integrity: { status: 'healthy', note: 'No data loaded yet.' },
    settlement_preview: { status: 'healthy', note: 'No data loaded yet.' },
    disputes: { status: 'healthy', note: 'No data loaded yet.' },
    incidents: { status: 'healthy', note: 'No data loaded yet.' },
    weather_evidence: { status: 'healthy', note: 'No data loaded yet.' },
    certifications: { status: 'healthy', note: 'No data loaded yet.' },
    rbac_reviews: { status: 'healthy', note: 'No data loaded yet.' },
    audit_investigation: { status: 'healthy', note: 'No data loaded yet.' },
    runbooks: { status: 'healthy', note: 'No data loaded yet.' },
    exposure: { status: 'healthy', note: 'No data loaded yet.' },
  };
  const operationalMetrics: OperationalMetrics = {
    unresolvedIncidents: 0,
    unresolvedDisputes: 0,
    overdueRunbooks: 0,
    unresolvedIntegrityWarnings: 0,
    staleMarkets: 0,
    pendingSettlementPreviews: 0,
  };

  // ── Wagers / pricing ────────────────────────────────────────────────────────
  let wagers: Wager[] = [];
  try {
    wagers = await listAllWagers(500);
    const lockedCount = wagers.filter(w => w.status === 'locked').length;
    const stale = wagers.filter(w => (w.status === 'open' || w.status === 'locked') && isPastTargetDate(w, STALE_MARKET_HOURS));
    operationalMetrics.staleMarkets = stale.length;
    for (const s of stale) {
      const ageMs = Date.now() - Date.parse(`${s.targetDate}T23:59:59Z`);
      staleDataWarnings.push({
        subsystem: 'wagers',
        detail: `Market "${s.title ?? s.id}" past targetDate ${s.targetDate} and still ${s.status}.`,
        ageMs: Number.isNaN(ageMs) ? undefined : ageMs,
      });
    }
    let wagerStatus: Severity = 'healthy';
    let wagerNote = `${wagers.length} wager(s) loaded (${lockedCount} locked).`;
    if (stale.length >= 5) { wagerStatus = 'critical'; wagerNote = `${stale.length} unresolved markets past target date.`; }
    else if (stale.length >= 1) { wagerStatus = 'degraded'; wagerNote = `${stale.length} unresolved market(s) past target date.`; }
    else if (lockedCount >= 5) { wagerStatus = 'monitor'; wagerNote = `${lockedCount} locked wager(s) awaiting grading.`; }
    subsystemStatus.wagers = {
      status: wagerStatus, note: wagerNote,
      metrics: { total: wagers.length, locked: lockedCount, staleMarkets: stale.length },
    };
    // Pricing reuses wager data — no separate store. Treat pricing as healthy unless wagers is degraded.
    subsystemStatus.pricing = {
      status: wagerStatus === 'critical' ? 'monitor' : wagerStatus === 'degraded' ? 'monitor' : 'healthy',
      note: wagers.length === 0
        ? 'No wagers — pricing recommendations are not exercised.'
        : 'Pricing engine is invoked from market creation flow only — no separate runtime store.',
    };
  } catch (err: any) {
    apiFailures.push({ subsystem: 'wagers', error: err?.message ?? String(err) });
    subsystemStatus.wagers = { status: 'critical', note: 'Wager store unavailable.' };
    subsystemStatus.pricing = { status: 'monitor', note: 'Pricing depends on wager store, which is unavailable.' };
  }

  // ── Incidents ───────────────────────────────────────────────────────────────
  try {
    const sum = await getIncidentSummary();
    operationalMetrics.unresolvedIncidents = sum.openCount;
    let s: Severity = 'healthy';
    let note = `${sum.total} incident(s) tracked, ${sum.openCount} open.`;
    if (sum.criticalOpen >= 1) { s = 'critical'; note = `${sum.criticalOpen} CRITICAL incident(s) unresolved.`; }
    else if (sum.openCount >= 5) { s = 'degraded'; note = `${sum.openCount} incident(s) unresolved.`; }
    else if (sum.openCount >= 1) { s = 'monitor'; note = `${sum.openCount} incident(s) open.`; }
    subsystemStatus.incidents = {
      status: s, note,
      metrics: { open: sum.openCount, critical: sum.criticalOpen, total: sum.total },
    };
    if (sum.openCount > 0) {
      backlogWarnings.push({ subsystem: 'incidents', detail: 'Open incidents needing investigation / resolution.', count: sum.openCount });
    }
    if (sum.criticalOpen > 0) {
      staleDataWarnings.push({ subsystem: 'incidents', detail: `${sum.criticalOpen} critical incident(s) unresolved.` });
    }
  } catch (err: any) {
    apiFailures.push({ subsystem: 'incidents', error: err?.message ?? String(err) });
    subsystemStatus.incidents = { status: 'monitor', note: 'Incident store unavailable.' };
  }

  // ── Disputes ────────────────────────────────────────────────────────────────
  try {
    const sum = await getDisputeSummary();
    operationalMetrics.unresolvedDisputes = sum.openCount;
    let s: Severity = 'healthy';
    let note = `${sum.total} dispute(s) tracked, ${sum.openCount} open.`;
    if (sum.criticalOpen >= 1) { s = 'critical'; note = `${sum.criticalOpen} CRITICAL dispute(s) unresolved.`; }
    else if (sum.openCount >= 5) { s = 'degraded'; note = `${sum.openCount} dispute(s) unresolved.`; }
    else if (sum.openCount >= 1) { s = 'monitor'; note = `${sum.openCount} dispute(s) open.`; }
    subsystemStatus.disputes = {
      status: s, note,
      metrics: { open: sum.openCount, critical: sum.criticalOpen, awaitingEvidence: sum.awaitingEvidence, total: sum.total },
    };
    if (sum.openCount > 0) {
      backlogWarnings.push({ subsystem: 'disputes', detail: 'Open disputes needing recommendation / resolution.', count: sum.openCount });
    }
    if (sum.criticalOpen > 0) {
      staleDataWarnings.push({ subsystem: 'disputes', detail: `${sum.criticalOpen} critical dispute(s) unresolved.` });
    }
  } catch (err: any) {
    apiFailures.push({ subsystem: 'disputes', error: err?.message ?? String(err) });
    subsystemStatus.disputes = { status: 'monitor', note: 'Dispute store unavailable.' };
  }

  // ── Integrity ───────────────────────────────────────────────────────────────
  try {
    const sum = await getIntegritySummary();
    operationalMetrics.unresolvedIntegrityWarnings = sum.bySeverity.warning + sum.bySeverity.critical;
    let s: Severity = 'healthy';
    let note = `${sum.totalReports} integrity report(s).`;
    if (sum.bySeverity.critical >= 1) { s = 'critical'; note = `${sum.bySeverity.critical} CRITICAL integrity report(s).`; }
    else if (sum.byVerdict.elevated_risk >= 1) { s = 'degraded'; note = `${sum.byVerdict.elevated_risk} elevated_risk report(s).`; }
    else if (sum.bySeverity.warning >= 1) { s = 'monitor'; note = `${sum.bySeverity.warning} warning report(s).`; }
    subsystemStatus.integrity = {
      status: s, note,
      metrics: {
        totalReports: sum.totalReports,
        critical: sum.bySeverity.critical, warning: sum.bySeverity.warning, info: sum.bySeverity.info,
        elevatedRisk: sum.byVerdict.elevated_risk, monitor: sum.byVerdict.monitor, healthy: sum.byVerdict.healthy,
        unresolvedAfterEventCount: sum.unresolvedAfterEventCount,
      },
    };
    if (sum.bySeverity.warning + sum.bySeverity.critical > 0) {
      backlogWarnings.push({
        subsystem: 'integrity',
        detail: 'Integrity reports at warning/critical severity awaiting review.',
        count: sum.bySeverity.warning + sum.bySeverity.critical,
      });
    }
    // Latest integrity report age
    try {
      const latestList = await listIntegrityReports(5);
      const latest = latestList[0];
      if (latest) {
        const ageDays = dayDiff(latest.generatedAt) ?? 0;
        if (ageDays > STALE_INTEGRITY_DAYS) {
          staleDataWarnings.push({
            subsystem: 'integrity',
            detail: `Latest integrity report is ${ageDays} day(s) old (> ${STALE_INTEGRITY_DAYS}d).`,
            ageMs: Date.now() - Date.parse(latest.generatedAt),
          });
        }
      } else if (sum.totalReports === 0 && wagers.length > 0) {
        staleDataWarnings.push({
          subsystem: 'integrity',
          detail: 'No integrity reports on file even though wagers exist.',
        });
      }
    } catch { /* swallow — already counted via summary */ }
  } catch (err: any) {
    apiFailures.push({ subsystem: 'integrity', error: err?.message ?? String(err) });
    subsystemStatus.integrity = { status: 'monitor', note: 'Integrity store unavailable.' };
  }

  // ── Settlement preview ──────────────────────────────────────────────────────
  try {
    const [graded, previews] = await Promise.all([
      listGradedWagersForSettlementPreview(500).catch(() => [] as any[]),
      listSettlementPreviews(500).catch(() => [] as any[]),
    ]);
    const previewedIds = new Set(previews.map(p => p.wagerId));
    const pending = graded.filter(w => !previewedIds.has(w.id)).length;
    operationalMetrics.pendingSettlementPreviews = pending;
    let s: Severity = 'healthy';
    let note = `${graded.length} graded/void market(s); ${previews.length} preview(s) on file.`;
    if (pending >= 5) { s = 'degraded'; note = `${pending} graded market(s) without a settlement preview.`; }
    else if (pending >= 1) { s = 'monitor'; note = `${pending} graded market(s) awaiting a settlement preview.`; }
    subsystemStatus.settlement_preview = {
      status: s, note,
      metrics: { gradedCount: graded.length, previews: previews.length, pending },
    };
    if (pending > 0) {
      backlogWarnings.push({
        subsystem: 'settlement_preview',
        detail: 'Graded markets without a settlement preview snapshot.',
        count: pending,
      });
      staleDataWarnings.push({
        subsystem: 'settlement_preview',
        detail: `${pending} graded/void market(s) lack a settlement preview.`,
      });
    }
  } catch (err: any) {
    apiFailures.push({ subsystem: 'settlement_preview', error: err?.message ?? String(err) });
    subsystemStatus.settlement_preview = { status: 'monitor', note: 'Settlement preview store unavailable.' };
  }

  // ── Certifications ──────────────────────────────────────────────────────────
  try {
    const { summary } = await buildCertSummary();
    const expiringSoonCount = summary.expiringSoonCount ?? 0;
    const byVerdict = summary.byVerdict ?? ({} as Record<string, number>);
    let s: Severity = 'healthy';
    let note = `${summary.totalOperators ?? 0} operator(s) tracked.`;
    if ((byVerdict.expired ?? 0) >= 1) { s = 'monitor'; note = `${byVerdict.expired} expired certification(s).`; }
    if (expiringSoonCount >= 3) { s = worse(s, 'monitor'); note = `${expiringSoonCount} certification(s) expire within 30 days.`; }
    if ((byVerdict.needs_practice ?? 0) >= 3) { s = worse(s, 'monitor'); }
    subsystemStatus.certifications = {
      status: s, note,
      metrics: {
        totalOperators: summary.totalOperators ?? 0,
        certified: byVerdict.certified ?? 0,
        expiringSoon: expiringSoonCount,
        needsPractice: byVerdict.needs_practice ?? 0,
        expired: byVerdict.expired ?? 0,
      },
    };
    if (expiringSoonCount > 0) {
      backlogWarnings.push({
        subsystem: 'certifications',
        detail: 'Operator certifications expiring within 30 days.',
        count: expiringSoonCount,
      });
    }
  } catch (err: any) {
    apiFailures.push({ subsystem: 'certifications', error: err?.message ?? String(err) });
    subsystemStatus.certifications = { status: 'monitor', note: 'Certification store unavailable.' };
  }

  // ── RBAC reviews ────────────────────────────────────────────────────────────
  try {
    const sum = await getOperatorRbacReviewSummary();
    let s: Severity = 'healthy';
    let note = `${sum.totalReviews} RBAC review(s).`;
    if (sum.bySeverity.critical >= 1) { s = 'degraded'; note = `${sum.bySeverity.critical} CRITICAL RBAC finding(s).`; }
    else if (sum.unacknowledged >= 5) { s = 'monitor'; note = `${sum.unacknowledged} RBAC review(s) unacknowledged.`; }
    else if (sum.bySeverity.warning >= 1) { s = 'monitor'; note = `${sum.bySeverity.warning} RBAC warning(s).`; }
    subsystemStatus.rbac_reviews = {
      status: s, note,
      metrics: {
        total: sum.totalReviews,
        critical: sum.bySeverity.critical, warning: sum.bySeverity.warning,
        unacknowledged: sum.unacknowledged, accessDataUnavailable: sum.accessDataUnavailable,
      },
    };
    if (sum.unacknowledged > 0) {
      backlogWarnings.push({
        subsystem: 'rbac_reviews',
        detail: 'RBAC review findings awaiting operator acknowledgement.',
        count: sum.unacknowledged,
      });
    }
  } catch (err: any) {
    apiFailures.push({ subsystem: 'rbac_reviews', error: err?.message ?? String(err) });
    subsystemStatus.rbac_reviews = { status: 'monitor', note: 'RBAC review store unavailable.' };
  }

  // ── Weather evidence ────────────────────────────────────────────────────────
  try {
    const sum = await getEvidenceSummary();
    let s: Severity = 'healthy';
    let note = `${sum.total} evidence record(s).`;
    if (sum.conflictCount >= 1) { s = 'monitor'; note = `${sum.conflictCount} conflicting evidence record(s).`; }
    if (sum.byVerdict.conflict_requires_review >= 1) {
      s = worse(s, 'degraded');
      note = `${sum.byVerdict.conflict_requires_review} evidence record(s) flagged conflict_requires_review.`;
    }
    subsystemStatus.weather_evidence = {
      status: s, note,
      metrics: {
        total: sum.total,
        conflicts: sum.conflictCount,
        insufficient: sum.insufficientCount,
        conflictRequiresReview: sum.byVerdict.conflict_requires_review,
        linkedToWagers: sum.linkedToWagers,
      },
    };
  } catch (err: any) {
    apiFailures.push({ subsystem: 'weather_evidence', error: err?.message ?? String(err) });
    subsystemStatus.weather_evidence = { status: 'monitor', note: 'Weather evidence store unavailable.' };
  }

  // ── Audit investigation (saved views only — actual events stored in audit log) ──
  try {
    const investigations = await listInvestigations(50);
    subsystemStatus.audit_investigation = {
      status: 'healthy',
      note: investigations.length === 0
        ? 'No saved investigations on file.'
        : `${investigations.length} saved investigation view(s).`,
      metrics: { savedViews: investigations.length },
    };
  } catch (err: any) {
    apiFailures.push({ subsystem: 'audit_investigation', error: err?.message ?? String(err) });
    subsystemStatus.audit_investigation = { status: 'monitor', note: 'Audit investigation store unavailable.' };
  }

  // ── Runbooks ────────────────────────────────────────────────────────────────
  try {
    const runbooks = await listRunbooks(30);
    const latestRunbook = runbooks[0];
    let s: Severity = 'healthy';
    let note = `${runbooks.length} runbook(s) on file.`;
    if (!latestRunbook) {
      s = 'monitor';
      note = 'No runbooks on file yet.';
    } else {
      const ageDays = dayDiff(latestRunbook.createdAt ?? latestRunbook.date) ?? 0;
      if (ageDays > STALE_RUNBOOK_DAYS) {
        s = 'monitor';
        note = `Latest runbook is ${ageDays} day(s) old (> ${STALE_RUNBOOK_DAYS}d).`;
        operationalMetrics.overdueRunbooks = 1;
        staleDataWarnings.push({
          subsystem: 'runbooks',
          detail: `Latest runbook is ${ageDays} day(s) old. Daily runbook cadence is the recordkeeping baseline.`,
          ageMs: ageDays * 24 * 60 * 60 * 1000,
        });
      }
    }
    subsystemStatus.runbooks = {
      status: s, note,
      metrics: { count: runbooks.length, overdueDays: operationalMetrics.overdueRunbooks },
    };
  } catch (err: any) {
    apiFailures.push({ subsystem: 'runbooks', error: err?.message ?? String(err) });
    subsystemStatus.runbooks = { status: 'monitor', note: 'Runbook store unavailable.' };
  }

  // ── Exposure ────────────────────────────────────────────────────────────────
  try {
    const exposureSnaps = await listExposureSnapshots(20);
    const latest = exposureSnaps[0] ?? null;
    let s: Severity = 'healthy';
    let note = exposureSnaps.length === 0
      ? 'No house-exposure snapshots on file yet.'
      : `${exposureSnaps.length} house-exposure snapshot(s) on file.`;
    if (latest && typeof latest.projectedNetHouseResult === 'number' && latest.projectedNetHouseResult <= -50_000) {
      s = 'monitor';
      note = `Latest exposure snapshot projects $${(latest.projectedNetHouseResult / 100).toFixed(2)} (worst case).`;
    }
    if (exposureSnaps.length === 0) s = 'monitor';
    subsystemStatus.exposure = {
      status: s, note,
      metrics: {
        snapshots: exposureSnaps.length,
        projectedNetCents: latest?.projectedNetHouseResult ?? null,
        marketsAtRisk: latest?.marketsAtRisk ?? null,
      },
    };
  } catch (err: any) {
    apiFailures.push({ subsystem: 'exposure', error: err?.message ?? String(err) });
    subsystemStatus.exposure = { status: 'monitor', note: 'House exposure store unavailable.' };
  }

  // ── Change control feeds backlog only (no separate subsystem in spec) ───────
  try {
    const sum = await getChangeSummary();
    if (sum.awaitingApproval > 0) {
      backlogWarnings.push({
        subsystem: 'incidents',
        detail: 'Change requests awaiting approval (governance backlog).',
        count: sum.awaitingApproval,
      });
    }
    if (sum.approvedNotImplemented > 0) {
      backlogWarnings.push({
        subsystem: 'incidents',
        detail: 'Approved changes still awaiting manual implementation.',
        count: sum.approvedNotImplemented,
      });
    }
  } catch { /* non-fatal — change control is not a primary subsystem here */ }

  // ── Redis health ────────────────────────────────────────────────────────────
  const redisHealth = await probeRedis();
  let redisSeverity: Severity = 'healthy';
  if (redisHealth.status === 'unavailable') redisSeverity = 'critical';
  else if (redisHealth.status === 'degraded') redisSeverity = 'monitor';

  // ── Roll up severity & warnings ────────────────────────────────────────────
  const subsystemSeverities: Severity[] = (Object.values(subsystemStatus) as SubsystemStatus[]).map(v => v.status);
  let overall = rollupSeverity([...subsystemSeverities, redisSeverity]);

  // API failures push severity higher
  if (apiFailures.length >= 3) overall = worse(overall, 'critical');
  else if (apiFailures.length >= 1) overall = worse(overall, 'degraded');

  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (apiFailures.length > 0) {
    warnings.push(`${apiFailures.length} subsystem read(s) failed. See API Failures table.`);
    recommendations.push('Investigate underlying Redis / store availability before issuing new wagers or grading.');
  }
  if (redisHealth.status === 'unavailable') {
    warnings.push('Redis probe failed — most platform operations will be unavailable.');
    recommendations.push('Verify Upstash credentials and network reachability. Hold off on grading and settlement preview generation.');
  } else if (redisHealth.status === 'degraded') {
    warnings.push(`Redis latency elevated (${redisHealth.latencyEstimateMs}ms).`);
    recommendations.push('Re-run after a few minutes; if persistent, escalate to platform on-call.');
  }
  if (operationalMetrics.staleMarkets > 0) {
    warnings.push(`${operationalMetrics.staleMarkets} market(s) past target date and not graded.`);
    recommendations.push('Open Wager Resolution and either grade or void each stale market.');
  }
  if (operationalMetrics.unresolvedIncidents > 0) {
    recommendations.push('Open Incident Management and triage the unresolved queue.');
  }
  if (operationalMetrics.unresolvedDisputes > 0) {
    recommendations.push('Open Dispute Workflow and act on open recommendations.');
  }
  if (operationalMetrics.pendingSettlementPreviews > 0) {
    recommendations.push('Open Settlement Preview and snapshot any graded market without a preview.');
  }
  if (operationalMetrics.overdueRunbooks > 0) {
    recommendations.push('Run today\'s Daily Runbook to keep the operating cadence on schedule.');
  }
  if (warnings.length === 0 && overall === 'healthy') {
    recommendations.push('All monitored subsystems are healthy. Continue normal operating cadence.');
  }

  const snapshot: HealthSnapshot = {
    id: newSnapshotId(),
    generatedAt: nowIso(),
    generatedBy: actor,
    subsystemStatus,
    staleDataWarnings,
    backlogWarnings,
    apiFailures,
    redisHealth,
    operationalMetrics,
    warnings,
    recommendations,
    severity: overall,
  };

  // ── Persist ─────────────────────────────────────────────────────────────────
  try {
    const redis = getRedis();
    await redis.set(`${SNAPSHOT_PREFIX}${snapshot.id}`, JSON.stringify(snapshot));
    await redis.set(LATEST_KEY, JSON.stringify(snapshot));
    await redis.zadd(SNAPSHOTS_SET, { score: Date.now(), member: snapshot.id });
    const count = await redis.zcard(SNAPSHOTS_SET);
    if (count > MAX_SNAPSHOTS) {
      const toRemove = await redis.zrange(SNAPSHOTS_SET, 0, count - MAX_SNAPSHOTS - 1);
      for (const rid of toRemove) await redis.del(`${SNAPSHOT_PREFIX}${rid}`);
      await redis.zremrangebyrank(SNAPSHOTS_SET, 0, count - MAX_SNAPSHOTS - 1);
    }
  } catch (err: any) {
    // Storage failure should not throw — log and continue. The snapshot
    // we return is still informative.
    snapshot.warnings.push(`Snapshot storage failed: ${err?.message ?? String(err)}`);
  }

  await logAuditEvent({
    actor,
    eventType: 'operational_health_snapshot_generated',
    targetType: 'operational_health_snapshot',
    targetId: snapshot.id,
    summary: `Operational health snapshot ${snapshot.id} (${snapshot.severity}). ${apiFailures.length} api failure(s), ${staleDataWarnings.length} stale, ${backlogWarnings.length} backlog.`,
    details: {
      id: snapshot.id,
      severity: snapshot.severity,
      apiFailures: apiFailures.length,
      staleDataWarnings: staleDataWarnings.length,
      backlogWarnings: backlogWarnings.length,
      redisStatus: redisHealth.status,
    },
  });

  return snapshot;
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getSnapshot(id: string): Promise<HealthSnapshot | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(`${SNAPSHOT_PREFIX}${id}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as HealthSnapshot;
  } catch { return null; }
}

export async function getLatestSnapshot(): Promise<HealthSnapshot | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(LATEST_KEY);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as HealthSnapshot;
  } catch { return null; }
}

export async function listSnapshots(limit = 100): Promise<HealthSnapshot[]> {
  try {
    const redis = getRedis();
    const ids = await redis.zrange(SNAPSHOTS_SET, 0, -1, { rev: true });
    if (!ids || ids.length === 0) return [];
    const sliced = ids.slice(0, limit);
    const out: HealthSnapshot[] = [];
    for (const id of sliced) {
      const raw = await redis.get(`${SNAPSHOT_PREFIX}${id}`);
      if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as HealthSnapshot);
    }
    return out;
  } catch { return []; }
}

export async function getOperationalHealthSummary(): Promise<OperationalHealthSummary> {
  const snaps = await listSnapshots(200);
  const severityCounts: Record<Severity, number> = { healthy: 0, monitor: 0, degraded: 0, critical: 0 };
  for (const s of snaps) severityCounts[s.severity]++;
  return {
    totalSnapshots: snaps.length,
    latestSnapshot: snaps[0] ?? null,
    severityCounts,
  };
}
