// ── Step 88: Daily Strategy Brief + scorecard alerts ────────────────────────
//
// Turns the Step 87 Strategy Operating Scorecard into a daily operating
// brief and an alert layer the desk can act on. Briefs are immutable
// snapshots; alerts are stateful (open → acknowledged → resolved) but only
// ever transitioned by an operator. Nothing here trades, submits orders,
// changes pilot state, or auto-promotes strategies.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { buildScorecard, type StrategyScorecard, type TopAction } from './strategy-scorecard';

// ── Types ───────────────────────────────────────────────────────────────────

export type BriefAlertStatus = 'open' | 'acknowledged' | 'resolved';
export type BriefAlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface BriefSection {
  score: number;
  grade: string;
  /** Headline metric values for the section (label → value). */
  highlights: { label: string; value: string | number | null }[];
}

export interface DailyBrief {
  id: string;
  createdAt: string;          // ISO
  date: string;               // YYYY-MM-DD (UTC)
  generatedBy: string;        // operator id
  overallScore: number;
  grade: string;
  topActions: TopAction[];
  operationalWarnings: string[];
  edgeSummary: BriefSection;
  allocationSummary: BriefSection;
  pilotSummary: BriefSection;
  governanceSummary: BriefSection;
  /** Stable rule keys for alerts that fired during this brief. */
  firedAlertKeys: string[];
  /** Free-form append-only notes added after generation (for the operator). */
  notes: string[];
  notes_explanation?: string;
}

export interface ScorecardAlert {
  id: string;
  ruleId: string;
  /** ruleId + optional target — used to de-dupe across briefs. */
  ruleKey: string;
  severity: BriefAlertSeverity;
  category: 'edge' | 'allocation' | 'pilot' | 'governance' | 'ops';
  title: string;
  description: string;
  link: string;
  status: BriefAlertStatus;
  firstFiredAt: string;
  lastFiredAt: string;
  fireCount: number;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
  notes: string[];
  /** Optional pointer to the originating brief. */
  originBriefId?: string;
}

export interface AlertRuleResult {
  ruleId: string;
  ruleKey: string;
  severity: BriefAlertSeverity;
  category: ScorecardAlert['category'];
  title: string;
  description: string;
  link: string;
}

export class BriefError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ─────────────────────────────────────────────────────

const BRIEF_PREFIX = 'strategy-brief:';
const BRIEF_SET = 'strategy-briefs:all';
const ALERT_PREFIX = 'scorecard-alert:';
const ALERT_SET = 'scorecard-alerts:all';
const ALERT_BY_KEY = 'scorecard-alerts:by-key:'; // by-key:{ruleKey} → alertId

const MAX_BRIEFS = 365;
const MAX_ALERTS = 1000;

// ── ID helpers ──────────────────────────────────────────────────────────────

function newBriefId(): string {
  return `brief-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newAlertId(): string {
  return `salert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Section builders ────────────────────────────────────────────────────────

function pickHighlights(inputs: Record<string, number | string | null>, keys: string[]): { label: string; value: string | number | null }[] {
  return keys
    .filter(k => k in inputs)
    .map(k => ({ label: k, value: inputs[k] }));
}

function buildSections(sc: StrategyScorecard): {
  edge: BriefSection; alloc: BriefSection; pilot: BriefSection; gov: BriefSection;
} {
  return {
    edge: {
      score: sc.edgeHealth.score,
      grade: sc.edgeHealth.grade,
      highlights: pickHighlights(sc.edgeHealth.inputs, ['sampleSize', 'overallBrier', 'validated', 'overestSegments', 'signals']),
    },
    alloc: {
      score: sc.allocationHealth.score,
      grade: sc.allocationHealth.grade,
      highlights: pickHighlights(sc.allocationHealth.inputs, ['verdict', 'eligibleSignals', 'maxConcentrationPct', 'meanDrawdownPctOfCapital', 'exposureRatioPct']),
    },
    pilot: {
      score: sc.pilotHealth.score,
      grade: sc.pilotHealth.grade,
      highlights: pickHighlights(sc.pilotHealth.inputs, ['active', 'total', 'breach', 'watch', 'aggregateRoiPct', 'drawdownPctOfCapital']),
    },
    gov: {
      score: sc.governanceHealth.score,
      grade: sc.governanceHealth.grade,
      highlights: pickHighlights(sc.governanceHealth.inputs, ['overdueDecisions', 'openDecisions', 'unreviewedActivePilots', 'draftReviews', 'pilotReadyWithoutPilot', 'acceptanceRatePct']),
    },
  };
}

// ── Alert rule evaluator ────────────────────────────────────────────────────

export function evaluateAlertRules(sc: StrategyScorecard): AlertRuleResult[] {
  const out: AlertRuleResult[] = [];

  // Rule 1: overall score below 60
  if (sc.overall.score < 60) {
    out.push({
      ruleId: 'overall-low',
      ruleKey: 'overall-low',
      severity: sc.overall.score < 40 ? 'critical' : 'high',
      category: 'governance',
      title: `Overall strategy health ${sc.overall.score} (${sc.overall.grade})`,
      description: 'Overall scorecard score is below 60. Review component breakdowns and clear top actions.',
      link: '/admin/system/strategy-scorecard',
    });
  }

  // Rule 2: any component score below 50
  const components: { name: string; score: number; category: ScorecardAlert['category']; link: string }[] = [
    { name: 'Edge',        score: sc.edgeHealth.score,        category: 'edge',       link: '/admin/system/calibration-lab' },
    { name: 'Allocation',  score: sc.allocationHealth.score,  category: 'allocation', link: '/admin/system/portfolio-allocation' },
    { name: 'Pilot',       score: sc.pilotHealth.score,       category: 'pilot',      link: '/admin/system/strategy-pilot' },
    { name: 'Governance',  score: sc.governanceHealth.score,  category: 'governance', link: '/admin/system/pilot-decisions' },
    { name: 'Operational', score: sc.operationalHealth.score, category: 'ops',        link: '/admin/system/paper-strategy-portfolio' },
  ];
  for (const c of components) {
    if (c.score < 50) {
      out.push({
        ruleId: 'component-low',
        ruleKey: `component-low:${c.name.toLowerCase()}`,
        severity: c.score < 30 ? 'critical' : 'high',
        category: c.category,
        title: `${c.name} health ${c.score} — below 50`,
        description: `${c.name} component is in the bottom band. Inspect reasons in the scorecard.`,
        link: c.link,
      });
    }
  }

  // Rule 3: overdue pilot decisions
  const overdue = sc.decisionSummary.overdueCount;
  if (overdue > 0) {
    out.push({
      ruleId: 'overdue-decisions',
      ruleKey: 'overdue-decisions',
      severity: overdue >= 3 ? 'critical' : 'high',
      category: 'governance',
      title: `${overdue} overdue pilot decision${overdue === 1 ? '' : 's'}`,
      description: 'Operator decisions past their due date. Resolve to keep the go/no-go program credible.',
      link: '/admin/system/pilot-decisions',
    });
  }

  // Rule 4: active pilot breach (one alert per breaching pilot id, parsed from operationalWarnings)
  for (const w of sc.operationalWarnings) {
    const m = w.match(/^Pilot (.+) \((.+)\) in BREACH$/);
    if (m) {
      out.push({
        ruleId: 'pilot-breach',
        ruleKey: `pilot-breach:${m[2]}`,
        severity: 'critical',
        category: 'pilot',
        title: `Pilot in BREACH: ${m[1]}`,
        description: 'Pilot has exceeded one or more configured limits. Review immediately.',
        link: `/admin/system/strategy-pilot?pilotId=${encodeURIComponent(m[2])}`,
      });
    }
  }

  // Rule 5: stress verdict unsafe/risky
  const verdictRaw = sc.allocationHealth.inputs.verdict;
  const verdict = typeof verdictRaw === 'string' ? verdictRaw : '';
  if (verdict === 'Critical' || verdict === 'Caution') {
    out.push({
      ruleId: 'stress-verdict',
      ruleKey: 'stress-verdict',
      severity: verdict === 'Critical' ? 'critical' : 'high',
      category: 'allocation',
      title: `Allocation stress verdict: ${verdict}`,
      description: 'Stress test on the current allocation indicates elevated drawdown / concentration risk.',
      link: '/admin/system/allocation-stress-test',
    });
  }

  // Rule 6: no recent paper outcome refresh (operational reasoning mirrors scorecard)
  const opCaptured = Number(sc.operationalHealth.inputs.paperCaptured ?? 0);
  const opOpen = Number(sc.operationalHealth.inputs.paperOpen ?? 0);
  if (opCaptured > 20 && opOpen / opCaptured > 0.80) {
    out.push({
      ruleId: 'paper-stale',
      ruleKey: 'paper-stale',
      severity: 'medium',
      category: 'ops',
      title: 'Paper portfolio outcomes need refreshing',
      description: `${opOpen} of ${opCaptured} paper records still open. Run "Refresh outcomes" on the paper portfolio.`,
      link: '/admin/system/paper-strategy-portfolio',
    });
  }

  // Rule 7: strategy eligible but no allocation capture
  const eligible = Number(sc.allocationHealth.inputs.eligibleSignals ?? 0);
  if (eligible > 0 && opCaptured === 0) {
    out.push({
      ruleId: 'eligible-no-capture',
      ruleKey: 'eligible-no-capture',
      severity: 'medium',
      category: 'allocation',
      title: `${eligible} eligible signal${eligible === 1 ? '' : 's'} but no paper capture`,
      description: 'Eligible signals exist but no paper record has been captured. Capture before evaluating performance.',
      link: '/admin/system/paper-strategy-portfolio',
    });
  }

  // Rule 8: pilot_ready strategy without pilot launched
  const pilotReadyWithoutPilot = Number(sc.governanceHealth.inputs.pilotReadyWithoutPilot ?? 0);
  if (pilotReadyWithoutPilot > 0) {
    out.push({
      ruleId: 'pilot-ready-no-pilot',
      ruleKey: 'pilot-ready-no-pilot',
      severity: 'medium',
      category: 'governance',
      title: `${pilotReadyWithoutPilot} pilot_ready strateg${pilotReadyWithoutPilot === 1 ? 'y' : 'ies'} without a pilot`,
      description: 'Strategy is approved for piloting but no pilot plan exists. Launch a pilot or revert to paper_approved.',
      link: '/admin/system/strategy-registry',
    });
  }

  return out;
}

// ── Brief generation ────────────────────────────────────────────────────────

export async function generateBrief(opts: { generatedBy: string; note?: string }): Promise<{ brief: DailyBrief; firedAlerts: ScorecardAlert[] }> {
  if (!opts.generatedBy) throw new BriefError('generatedBy is required', 'generated_by_required');

  const sc = await buildScorecard();
  const sections = buildSections(sc);
  const fired = evaluateAlertRules(sc);

  // Sync alerts (de-dupe by ruleKey across open/acknowledged)
  const firedAlerts: ScorecardAlert[] = [];
  for (const r of fired) {
    const synced = await upsertAlertFromRule(r);
    firedAlerts.push(synced);
  }

  const id = newBriefId();
  const now = new Date().toISOString();
  const brief: DailyBrief = {
    id,
    createdAt: now,
    date: todayUtcDate(),
    generatedBy: opts.generatedBy,
    overallScore: sc.overall.score,
    grade: sc.overall.grade,
    topActions: sc.topActions,
    operationalWarnings: sc.operationalWarnings,
    edgeSummary: sections.edge,
    allocationSummary: sections.alloc,
    pilotSummary: sections.pilot,
    governanceSummary: sections.gov,
    firedAlertKeys: fired.map(r => r.ruleKey),
    notes: opts.note ? [`[${now}] ${opts.generatedBy}: ${opts.note}`] : [],
  };

  const redis = getRedis();
  await redis.set(`${BRIEF_PREFIX}${id}`, JSON.stringify(brief));
  await redis.zadd(BRIEF_SET, { score: Date.now(), member: id });
  await trimToCap(redis, BRIEF_SET, BRIEF_PREFIX, MAX_BRIEFS);

  // Stamp originating brief on freshly created alerts that don't have one yet
  for (const a of firedAlerts) {
    if (!a.originBriefId) {
      const updated = { ...a, originBriefId: id };
      await redis.set(`${ALERT_PREFIX}${a.id}`, JSON.stringify(updated));
    }
  }

  await logAuditEvent({
    actor: opts.generatedBy,
    eventType: 'strategy_brief_generated',
    targetType: 'strategy',
    targetId: id,
    summary: `Daily strategy brief ${id} generated (overall ${sc.overall.score} ${sc.overall.grade}, ${firedAlerts.length} alert(s) fired)`,
    details: { briefId: id, overallScore: sc.overall.score, grade: sc.overall.grade, firedAlertKeys: brief.firedAlertKeys },
  });

  return { brief, firedAlerts };
}

// ── Alert upsert / mutations ────────────────────────────────────────────────

async function upsertAlertFromRule(r: AlertRuleResult): Promise<ScorecardAlert> {
  const redis = getRedis();
  const byKeyKey = `${ALERT_BY_KEY}${r.ruleKey}`;
  const existingId = await redis.get(byKeyKey);
  const existingAlertId = typeof existingId === 'string' ? existingId : (existingId as any);

  if (existingAlertId) {
    const raw = await redis.get(`${ALERT_PREFIX}${existingAlertId}`);
    if (raw) {
      const existing = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ScorecardAlert;
      // If alert is already resolved, the rule firing again counts as a NEW occurrence — start fresh.
      if (existing.status !== 'resolved') {
        const updated: ScorecardAlert = {
          ...existing,
          // refresh wording (rule may produce different text as numbers change)
          severity: r.severity,
          title: r.title,
          description: r.description,
          link: r.link,
          lastFiredAt: new Date().toISOString(),
          fireCount: existing.fireCount + 1,
        };
        await redis.set(`${ALERT_PREFIX}${existing.id}`, JSON.stringify(updated));
        return updated;
      }
    }
  }

  // Create a fresh alert
  const id = newAlertId();
  const now = new Date().toISOString();
  const alert: ScorecardAlert = {
    id,
    ruleId: r.ruleId,
    ruleKey: r.ruleKey,
    severity: r.severity,
    category: r.category,
    title: r.title,
    description: r.description,
    link: r.link,
    status: 'open',
    firstFiredAt: now,
    lastFiredAt: now,
    fireCount: 1,
    notes: [],
  };

  await redis.set(`${ALERT_PREFIX}${id}`, JSON.stringify(alert));
  await redis.zadd(ALERT_SET, { score: Date.now(), member: id });
  await redis.set(byKeyKey, id);
  await trimToCap(redis, ALERT_SET, ALERT_PREFIX, MAX_ALERTS);

  return alert;
}

export async function getAlert(id: string): Promise<ScorecardAlert | null> {
  const redis = getRedis();
  const raw = await redis.get(`${ALERT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as ScorecardAlert);
}

export async function listAlerts(limit = 200): Promise<ScorecardAlert[]> {
  const redis = getRedis();
  const total = await redis.zcard(ALERT_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(ALERT_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: ScorecardAlert[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${ALERT_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function acknowledgeAlert(id: string, actor: string, note?: string): Promise<ScorecardAlert> {
  const existing = await getAlert(id);
  if (!existing) throw new BriefError('Alert not found', 'alert_not_found');
  if (existing.status === 'resolved') throw new BriefError('Cannot acknowledge a resolved alert', 'illegal_transition');
  const now = new Date().toISOString();
  const next: ScorecardAlert = {
    ...existing,
    status: 'acknowledged',
    acknowledgedAt: existing.acknowledgedAt ?? now,
    acknowledgedBy: existing.acknowledgedBy ?? actor,
    notes: note?.trim() ? [...existing.notes, `[${now}] ${actor}: ${note.trim()}`] : existing.notes,
  };
  const redis = getRedis();
  await redis.set(`${ALERT_PREFIX}${id}`, JSON.stringify(next));
  await logAuditEvent({
    actor,
    eventType: 'scorecard_alert_acknowledged',
    targetType: 'scorecard_alert',
    targetId: id,
    summary: `Alert ${id} (${existing.ruleId}) acknowledged`,
    details: { alertId: id, ruleId: existing.ruleId, ruleKey: existing.ruleKey },
  });
  return next;
}

export async function resolveAlert(id: string, actor: string, resolution: string): Promise<ScorecardAlert> {
  if (!resolution || !resolution.trim()) throw new BriefError('resolution is required', 'resolution_required');
  const existing = await getAlert(id);
  if (!existing) throw new BriefError('Alert not found', 'alert_not_found');
  if (existing.status === 'resolved') throw new BriefError('Alert already resolved', 'already_resolved');
  const now = new Date().toISOString();
  const next: ScorecardAlert = {
    ...existing,
    status: 'resolved',
    resolvedAt: now,
    resolvedBy: actor,
    resolution: resolution.trim(),
    notes: [...existing.notes, `[${now}] ${actor}: resolved — ${resolution.trim()}`],
  };
  const redis = getRedis();
  await redis.set(`${ALERT_PREFIX}${id}`, JSON.stringify(next));
  // Drop the by-key pointer so a future firing creates a fresh alert
  await redis.del(`${ALERT_BY_KEY}${existing.ruleKey}`);

  await logAuditEvent({
    actor,
    eventType: 'scorecard_alert_resolved',
    targetType: 'scorecard_alert',
    targetId: id,
    summary: `Alert ${id} (${existing.ruleId}) resolved`,
    details: { alertId: id, ruleId: existing.ruleId, ruleKey: existing.ruleKey, resolution: resolution.trim() },
  });
  return next;
}

export async function addAlertNote(id: string, note: string, actor: string): Promise<ScorecardAlert> {
  if (!note || !note.trim()) throw new BriefError('note is required', 'note_required');
  const existing = await getAlert(id);
  if (!existing) throw new BriefError('Alert not found', 'alert_not_found');
  const now = new Date().toISOString();
  const next: ScorecardAlert = {
    ...existing,
    notes: [...existing.notes, `[${now}] ${actor}: ${note.trim()}`].slice(-100),
  };
  const redis = getRedis();
  await redis.set(`${ALERT_PREFIX}${id}`, JSON.stringify(next));
  return next;
}

// ── Brief notes (append-only) ───────────────────────────────────────────────

export async function addBriefNote(id: string, note: string, actor: string): Promise<DailyBrief> {
  if (!note || !note.trim()) throw new BriefError('note is required', 'note_required');
  const redis = getRedis();
  const raw = await redis.get(`${BRIEF_PREFIX}${id}`);
  if (!raw) throw new BriefError('Brief not found', 'brief_not_found');
  const existing = (typeof raw === 'string' ? JSON.parse(raw) : raw) as DailyBrief;
  const now = new Date().toISOString();
  const next: DailyBrief = {
    ...existing,
    notes: [...existing.notes, `[${now}] ${actor}: ${note.trim()}`].slice(-200),
  };
  await redis.set(`${BRIEF_PREFIX}${id}`, JSON.stringify(next));
  return next;
}

// ── Brief listing ───────────────────────────────────────────────────────────

export async function getBrief(id: string): Promise<DailyBrief | null> {
  const redis = getRedis();
  const raw = await redis.get(`${BRIEF_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as DailyBrief);
}

export async function listBriefs(limit = 60): Promise<DailyBrief[]> {
  const redis = getRedis();
  const total = await redis.zcard(BRIEF_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(BRIEF_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: DailyBrief[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${BRIEF_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

// ── Aggregations for the History tab ───────────────────────────────────────

export interface BriefHistorySummary {
  totalBriefs: number;
  scoreTrend: { date: string; score: number; grade: string }[];
  gradeCounts: Record<string, number>;
  recurringWarnings: { warning: string; count: number }[];
  recurringFiredRules: { ruleKey: string; count: number }[];
}

export function summarizeHistory(briefs: DailyBrief[]): BriefHistorySummary {
  const scoreTrend = briefs
    .slice() // copy
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(b => ({ date: b.date, score: b.overallScore, grade: b.grade }));

  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const b of briefs) gradeCounts[b.grade] = (gradeCounts[b.grade] ?? 0) + 1;

  const warningCounts = new Map<string, number>();
  for (const b of briefs) for (const w of b.operationalWarnings) warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1);
  const recurringWarnings = Array.from(warningCounts.entries())
    .map(([warning, count]) => ({ warning, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const ruleCounts = new Map<string, number>();
  for (const b of briefs) for (const k of b.firedAlertKeys) ruleCounts.set(k, (ruleCounts.get(k) ?? 0) + 1);
  const recurringFiredRules = Array.from(ruleCounts.entries())
    .map(([ruleKey, count]) => ({ ruleKey, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    totalBriefs: briefs.length,
    scoreTrend,
    gradeCounts,
    recurringWarnings,
    recurringFiredRules,
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
