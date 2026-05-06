// ── Step 103: End-of-Day Operations Report ──────────────────────────────────
//
// Snapshot a date's market / resolution / settlement / integrity / governance
// activity into a persisted report. Read-only across upstream sources; writes
// confined to eod-report:* and the audit log. Never creates wagers, never
// grades / voids / settles, never mutates RBAC, never changes pricing.

import { getRedis } from './redis';
import { logAuditEvent, listAuditEvents, type AuditEvent } from './audit-log';
import { listAllWagers } from './wager-store';
import { listSettlementPreviews } from './wager-settlement-preview';
import { listIntegrityReports, getIntegritySummary } from './market-integrity';
import { getRunbook, progressOf as runbookProgress } from './daily-operator-runbook';
import { buildCertSummary } from './operator-certification';
import { getOperatorRbacReviewSummary } from './operator-rbac-review';
import type { Wager } from './wager-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportStatus = 'snapshot_only';

export interface MarketSummary {
  createdCount: number;
  openCount: number;
  lockedCount: number;
  gradedCount: number;
  voidedCount: number;
}

export interface ResolutionSummary {
  previewsGenerated: number;
  manuallyGraded: number;
  manuallyVoided: number;
}

export interface SettlementPreviewSummary {
  previewsGenerated: number;
  /** Sum of estimatedNetHouseResultCents across previews generated on the date. */
  projectedNetHouseResult: number;
  /** Count of previews with at least one liabilityWarning. */
  highLiabilityWarnings: number;
}

export interface IntegritySummary {
  reportsGenerated: number;
  healthyCount: number;
  monitorCount: number;
  elevatedRiskCount: number;
  /** Severity=critical reports generated on the date. */
  criticalWarnings: number;
}

export interface OperatorGovernanceSummary {
  runbookStatus: 'open' | 'completed' | 'not_started' | 'unavailable';
  runbookProgressPct: number | null;
  /** Currently expiring certifications + verdicts that need attention. */
  certificationWarnings: number;
  certificationDetails?: { expiringSoon: number; needsPractice: number; notReady: number; expired: number };
  /** Current RBAC review warnings + critical, plus unacknowledged. */
  rbacWarnings: number;
  rbacDetails?: { critical: number; warning: number; unacknowledged: number };
}

export interface NotableEvent {
  id: string;
  at: string;
  actor: string;
  eventType: string;
  summary: string;
  link?: string;
}

export interface RecommendedAction {
  label: string;
  href: string;
  tier: 'critical' | 'warning' | 'info';
}

export interface EndOfDayReport {
  id: string;             // == date
  date: string;           // YYYY-MM-DD
  generatedAt: string;
  generatedBy: string;
  marketSummary: MarketSummary;
  resolutionSummary: ResolutionSummary;
  settlementPreviewSummary: SettlementPreviewSummary;
  integritySummary: IntegritySummary;
  operatorGovernanceSummary: OperatorGovernanceSummary;
  notableEvents: NotableEvent[];
  warnings: string[];
  recommendedNextActions: RecommendedAction[];
  /** Diagnostics for upstream reads that failed. */
  dataGaps: string[];
  status: ReportStatus;
}

export class EndOfDayReportError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const REPORT_PREFIX = 'eod-report:';
const REPORTS_SET = 'eod-reports:all';
const MAX_REPORTS = 365;

// ── Helpers ──────────────────────────────────────────────────────────────────

const RESOLUTION_EVENT_TYPES = new Set([
  'wager_resolution_preview_generated',
  'wager_manually_graded',
  'wager_manually_voided',
]);

const NOTABLE_EVENT_TYPES = new Set([
  'wager_manually_graded',
  'wager_manually_voided',
  'operator_certified',
  'operator_certification_revoked',
  'operator_certification_expired',
  'operator_rbac_review_generated',
  'market_integrity_report_generated',
  'wager_settlement_preview_generated',
  'daily_runbook_completed',
  'daily_runbook_created',
]);

function isOnDate(iso: string | undefined, date: string): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) === date;
}

function isValidYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

// ── Wager subsection ─────────────────────────────────────────────────────────

function buildMarketSummary(wagers: Wager[], date: string): MarketSummary {
  const createdToday = wagers.filter(w => isOnDate(w.createdAt, date));
  const open = createdToday.filter(w => w.status === 'open').length;
  const locked = createdToday.filter(w => w.status === 'locked').length;
  const graded = createdToday.filter(w => w.status === 'graded').length;
  const voided = createdToday.filter(w => w.status === 'void').length;
  return {
    createdCount: createdToday.length,
    openCount: open,
    lockedCount: locked,
    gradedCount: graded,
    voidedCount: voided,
  };
}

// ── Resolution subsection ────────────────────────────────────────────────────

function buildResolutionSummary(events: AuditEvent[], date: string): ResolutionSummary {
  const onDate = events.filter(e => RESOLUTION_EVENT_TYPES.has(e.eventType) && isOnDate(e.createdAt, date));
  return {
    previewsGenerated: onDate.filter(e => e.eventType === 'wager_resolution_preview_generated').length,
    manuallyGraded: onDate.filter(e => e.eventType === 'wager_manually_graded').length,
    manuallyVoided: onDate.filter(e => e.eventType === 'wager_manually_voided').length,
  };
}

// ── Settlement preview subsection ────────────────────────────────────────────

function buildSettlementSummary(previews: any[], date: string): SettlementPreviewSummary {
  const onDate = previews.filter(p => isOnDate(p?.generatedAt, date));
  const projectedNetHouseResult = onDate.reduce((s, p) => s + (p?.estimatedNetHouseResult ?? 0), 0);
  const highLiabilityWarnings = onDate.filter(p => (p?.liabilityWarnings ?? []).length > 0).length;
  return {
    previewsGenerated: onDate.length,
    projectedNetHouseResult,
    highLiabilityWarnings,
  };
}

// ── Integrity subsection ─────────────────────────────────────────────────────

function buildIntegritySummary(reports: any[], date: string): IntegritySummary {
  const onDate = reports.filter(r => isOnDate(r?.generatedAt, date));
  return {
    reportsGenerated: onDate.length,
    healthyCount: onDate.filter(r => r?.verdict === 'healthy').length,
    monitorCount: onDate.filter(r => r?.verdict === 'monitor').length,
    elevatedRiskCount: onDate.filter(r => r?.verdict === 'elevated_risk').length,
    criticalWarnings: onDate.filter(r => r?.severity === 'critical').length,
  };
}

// ── Operator governance subsection ───────────────────────────────────────────

async function buildGovernanceSummary(date: string, dataGaps: string[]): Promise<OperatorGovernanceSummary> {
  const out: OperatorGovernanceSummary = {
    runbookStatus: 'unavailable',
    runbookProgressPct: null,
    certificationWarnings: 0,
    rbacWarnings: 0,
  };

  // Runbook
  try {
    const rb = await getRunbook(date);
    if (!rb) {
      out.runbookStatus = 'not_started';
    } else {
      out.runbookStatus = rb.status;
      out.runbookProgressPct = runbookProgress(rb).percentComplete;
    }
  } catch {
    dataGaps.push('Daily runbook lookup failed.');
  }

  // Certification
  try {
    const cert = await buildCertSummary();
    const expiringSoon = cert.summary?.expiringSoonCount ?? 0;
    const needsPractice = cert.summary?.byVerdict?.needs_practice ?? 0;
    const notReady = cert.summary?.byVerdict?.not_ready ?? 0;
    const expired = cert.summary?.byVerdict?.expired ?? 0;
    out.certificationWarnings = expiringSoon + needsPractice + notReady + expired;
    out.certificationDetails = { expiringSoon, needsPractice, notReady, expired };
  } catch {
    dataGaps.push('Operator certification summary unavailable.');
  }

  // RBAC review
  try {
    const rbac = await getOperatorRbacReviewSummary();
    const critical = rbac.bySeverity?.critical ?? 0;
    const warning = rbac.bySeverity?.warning ?? 0;
    const unacknowledged = rbac.unacknowledged ?? 0;
    out.rbacWarnings = critical + warning;
    out.rbacDetails = { critical, warning, unacknowledged };
  } catch {
    dataGaps.push('RBAC review summary unavailable.');
  }

  return out;
}

// ── Notable events ───────────────────────────────────────────────────────────

function buildNotableEvents(events: AuditEvent[], date: string): NotableEvent[] {
  const onDate = events
    .filter(e => NOTABLE_EVENT_TYPES.has(e.eventType) && isOnDate(e.createdAt, date))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const linkFor = (e: AuditEvent): string | undefined => {
    switch (e.eventType) {
      case 'wager_manually_graded':
      case 'wager_manually_voided':
      case 'wager_resolution_preview_generated':
        return '/admin/system/wager-resolution';
      case 'wager_settlement_preview_generated':
        return '/admin/system/wager-settlement-preview';
      case 'market_integrity_report_generated':
        return '/admin/system/market-integrity';
      case 'operator_certified':
      case 'operator_certification_revoked':
      case 'operator_certification_expired':
        return '/admin/system/operator-certification';
      case 'operator_rbac_review_generated':
        return '/admin/system/operator-rbac-review';
      case 'daily_runbook_created':
      case 'daily_runbook_completed':
        return '/admin/system/daily-operator-runbook';
      default: return undefined;
    }
  };

  // Cap at 25 to keep the report compact and the UI scannable.
  return onDate.slice(0, 25).map(e => ({
    id: e.id,
    at: e.createdAt,
    actor: e.actor,
    eventType: e.eventType,
    summary: e.summary,
    link: linkFor(e),
  }));
}

// ── Warnings + recommended actions ───────────────────────────────────────────

function buildWarningsAndActions(input: {
  marketSummary: MarketSummary;
  resolutionSummary: ResolutionSummary;
  settlementPreviewSummary: SettlementPreviewSummary;
  integritySummary: IntegritySummary;
  governance: OperatorGovernanceSummary;
  liveIntegrity: { unresolvedAfterEventCount: number } | null;
  dataGaps: string[];
}): { warnings: string[]; actions: RecommendedAction[] } {
  const warnings: string[] = [];
  const actions: RecommendedAction[] = [];

  // Market warnings
  if (input.marketSummary.lockedCount > 0) {
    warnings.push(`${input.marketSummary.lockedCount} wager(s) created today are still locked — may need grading.`);
    actions.push({ tier: 'warning', label: `Grade ${input.marketSummary.lockedCount} locked wager(s) created today`, href: '/admin/system/wager-resolution' });
  }
  if (input.marketSummary.openCount > 0 && input.marketSummary.createdCount > 0) {
    // Open wagers from today are likely fine (they haven't reached lock time); mention only if there are no
    // grades or voids at all (light info)
    if (input.resolutionSummary.manuallyGraded === 0 && input.resolutionSummary.manuallyVoided === 0) {
      // no-op — no warning needed
    }
  }

  // Resolution warnings
  if (input.resolutionSummary.manuallyVoided > 3) {
    warnings.push(`${input.resolutionSummary.manuallyVoided} manual voids today — investigate cause patterns.`);
  }

  // Settlement warnings
  if (input.settlementPreviewSummary.previewsGenerated > 0
      && input.settlementPreviewSummary.projectedNetHouseResult < 0) {
    warnings.push(`Aggregate projected net house result is negative ($${(input.settlementPreviewSummary.projectedNetHouseResult / 100).toFixed(2)}). Confirm winning outcomes.`);
    actions.push({ tier: 'critical', label: 'Review settlement previews with negative net house result', href: '/admin/system/wager-settlement-preview' });
  }
  if (input.settlementPreviewSummary.highLiabilityWarnings > 0) {
    warnings.push(`${input.settlementPreviewSummary.highLiabilityWarnings} settlement preview(s) carry liability warnings.`);
  }

  // Integrity
  if (input.integritySummary.elevatedRiskCount > 0) {
    warnings.push(`${input.integritySummary.elevatedRiskCount} integrity report(s) at elevated risk.`);
    actions.push({ tier: 'critical', label: `Investigate ${input.integritySummary.elevatedRiskCount} elevated-risk integrity report(s)`, href: '/admin/system/market-integrity' });
  }
  if (input.integritySummary.criticalWarnings > 0) {
    warnings.push(`${input.integritySummary.criticalWarnings} integrity report(s) at critical severity today.`);
  }
  if (input.liveIntegrity && input.liveIntegrity.unresolvedAfterEventCount > 0) {
    warnings.push(`${input.liveIntegrity.unresolvedAfterEventCount} market(s) currently unresolved past their target date.`);
    actions.push({ tier: 'critical', label: `Resolve ${input.liveIntegrity.unresolvedAfterEventCount} unresolved market(s)`, href: '/admin/system/wager-resolution' });
  }

  // Governance
  if (input.governance.runbookStatus === 'not_started') {
    warnings.push('Daily runbook not started for this date.');
    actions.push({ tier: 'warning', label: 'Start the daily runbook', href: '/admin/system/daily-operator-runbook' });
  } else if (input.governance.runbookStatus === 'open') {
    warnings.push(`Daily runbook still open${input.governance.runbookProgressPct != null ? ` (${input.governance.runbookProgressPct}% complete)` : ''}.`);
    actions.push({ tier: 'info', label: 'Finish today’s runbook', href: '/admin/system/daily-operator-runbook' });
  }
  if (input.governance.certificationDetails?.expiringSoon && input.governance.certificationDetails.expiringSoon > 0) {
    warnings.push(`${input.governance.certificationDetails.expiringSoon} operator certification(s) expire in the next 30 days.`);
    actions.push({ tier: 'info', label: 'Review expiring certifications', href: '/admin/system/operator-certification' });
  }
  if (input.governance.rbacDetails?.critical && input.governance.rbacDetails.critical > 0) {
    warnings.push(`${input.governance.rbacDetails.critical} RBAC review(s) at critical severity.`);
    actions.push({ tier: 'critical', label: 'Review critical RBAC reviews', href: '/admin/system/operator-rbac-review' });
  }
  if (input.governance.rbacDetails?.unacknowledged && input.governance.rbacDetails.unacknowledged > 0) {
    actions.push({ tier: 'info', label: `Acknowledge ${input.governance.rbacDetails.unacknowledged} pending RBAC review(s)`, href: '/admin/system/operator-rbac-review' });
  }

  // Data gaps surface as warnings too
  for (const gap of input.dataGaps) warnings.push(`Data gap: ${gap}`);

  // Sort actions by tier
  const tierRank: Record<RecommendedAction['tier'], number> = { critical: 0, warning: 1, info: 2 };
  actions.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);

  return { warnings, actions };
}

// ── Generate ─────────────────────────────────────────────────────────────────

export async function generateEndOfDayReport(date: string, actor: string): Promise<EndOfDayReport> {
  if (!actor) throw new EndOfDayReportError('actor is required', 'actor_required');
  if (!date) throw new EndOfDayReportError('date is required', 'date_required');
  if (!isValidYmd(date)) throw new EndOfDayReportError('date must be YYYY-MM-DD', 'invalid_date');

  const dataGaps: string[] = [];

  // ── Read upstream sources defensively ──
  const wagers = await listAllWagers(500).catch(() => { dataGaps.push('Wager list unavailable.'); return [] as Wager[]; });
  const auditEvents = await listAuditEvents(500).catch(() => { dataGaps.push('Audit log unavailable.'); return [] as AuditEvent[]; });
  const settlementPreviews = await listSettlementPreviews(500).catch(() => { dataGaps.push('Settlement previews unavailable.'); return [] as any[]; });
  const integrityReports = await listIntegrityReports(500).catch(() => { dataGaps.push('Integrity reports unavailable.'); return [] as any[]; });
  const liveIntegrity = await getIntegritySummary().catch(() => { dataGaps.push('Live integrity summary unavailable.'); return null; });

  // ── Build subsections ──
  const marketSummary = buildMarketSummary(wagers, date);
  const resolutionSummary = buildResolutionSummary(auditEvents, date);
  const settlementPreviewSummary = buildSettlementSummary(settlementPreviews, date);
  const integritySummary = buildIntegritySummary(integrityReports, date);
  const governance = await buildGovernanceSummary(date, dataGaps);
  const notableEvents = buildNotableEvents(auditEvents, date);

  const { warnings, actions } = buildWarningsAndActions({
    marketSummary, resolutionSummary, settlementPreviewSummary, integritySummary,
    governance,
    liveIntegrity: liveIntegrity ? { unresolvedAfterEventCount: liveIntegrity.unresolvedAfterEventCount ?? 0 } : null,
    dataGaps,
  });

  const report: EndOfDayReport = {
    id: date,
    date,
    generatedAt: new Date().toISOString(),
    generatedBy: actor,
    marketSummary,
    resolutionSummary,
    settlementPreviewSummary,
    integritySummary,
    operatorGovernanceSummary: governance,
    notableEvents,
    warnings,
    recommendedNextActions: actions,
    dataGaps,
    status: 'snapshot_only',
  };

  // Persist (eod-report namespace only)
  const redis = getRedis();
  await redis.set(`${REPORT_PREFIX}${date}`, JSON.stringify(report));
  await redis.zadd(REPORTS_SET, { score: Date.now(), member: date });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'end_of_day_report_generated',
    targetType: 'end_of_day_report',
    targetId: date,
    summary: `End-of-day report ${date} generated by ${actor} (warnings=${warnings.length}, actions=${actions.length}, dataGaps=${dataGaps.length})`,
    details: {
      date, warningCount: warnings.length, actionCount: actions.length, dataGaps,
      marketCreated: marketSummary.createdCount,
      manuallyGraded: resolutionSummary.manuallyGraded,
      manuallyVoided: resolutionSummary.manuallyVoided,
      settlementPreviewsGenerated: settlementPreviewSummary.previewsGenerated,
      integrityReportsGenerated: integritySummary.reportsGenerated,
      runbookStatus: governance.runbookStatus,
    },
  });

  return report;
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export async function getEndOfDayReport(date: string): Promise<EndOfDayReport | null> {
  if (!date) return null;
  const redis = getRedis();
  const raw = await redis.get(`${REPORT_PREFIX}${date}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as EndOfDayReport);
}

export async function listEndOfDayReports(limit = 60): Promise<EndOfDayReport[]> {
  const redis = getRedis();
  const total = await redis.zcard(REPORTS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(REPORTS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: EndOfDayReport[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${REPORT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Trim ─────────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(REPORTS_SET);
  if (total <= MAX_REPORTS) return;
  const overflow = total - MAX_REPORTS;
  const oldest = await redis.zrange(REPORTS_SET, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(REPORTS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${REPORT_PREFIX}${oldId}`);
  }
}
