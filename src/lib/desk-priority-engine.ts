// ── Step 89: Desk priority engine + action queue ────────────────────────────
//
// Reads scorecard + alerts + briefs + decisions + pilots and emits a single
// prioritized, time-aware queue of tasks for the operator. Read-only across
// the entire program: never auto-pauses pilots, never submits orders, never
// creates execution candidates, never auto-promotes strategies.

import { buildScorecard, type StrategyScorecard, type TopAction, type ActionPriority, type ActionCategory } from './strategy-scorecard';
import { listAlerts, type ScorecardAlert } from './strategy-brief';
import { listDecisions, type DecisionRecord, isOverdue } from './pilot-decision-tracker';
import { listPilots, computePilotMonitoring, type PilotPlan, type PilotMonitoring } from './strategy-pilot';
import { listReviews, type PilotReview } from './pilot-review';

// ── Types ───────────────────────────────────────────────────────────────────

export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export type Category = 'edge' | 'allocation' | 'pilot' | 'governance' | 'ops';
export type TaskSource = 'scorecard' | 'alert' | 'brief';
export type Tier = 'critical_now' | 'today' | 'soon' | 'backlog';

export interface DeskTask {
  id: string;
  priorityScore: number;        // 0..100
  urgency: Urgency;
  category: Category;
  title: string;
  description: string;
  link: string;
  source: TaskSource;
  /** ISO date if a deadline is known, otherwise a free-form hint. */
  deadlineHint?: string;
  /** True if leaving this task open blocks a downstream decision/promotion. */
  blocking: boolean;
  reason: string;
  /** Internal only — used to dedupe across overlapping sources. Not displayed. */
  dedupeKey: string;
  /** Optional: how many times the underlying signal has fired. */
  fireCount?: number;
  /** Tier derived from priorityScore. */
  tier: Tier;
  /** Factor breakdown for the methodology view. */
  factors: PriorityFactors;
}

export interface PriorityFactors {
  severity: number;        // 0..40
  timeSensitivity: number; // 0..30
  riskImpact: number;      // 0..30
  dependency: number;      // 0..20
  recurrence: number;      // 0..10
  raw: number;             // sum (pre-cap)
}

export interface DeskQueueSummary {
  total: number;
  byTier: Record<Tier, number>;
  byUrgency: Record<Urgency, number>;
  byCategory: Record<Category, number>;
  bySource: Record<TaskSource, number>;
  blockingCount: number;
  overdueCount: number;
  topPriorityScore: number;
}

export interface DeskQueue {
  generatedAt: string;
  queue: DeskTask[];                                            // sorted desc by priorityScore
  byTier: Record<Tier, DeskTask[]>;
  summary: DeskQueueSummary;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

interface ScoreInput {
  severity: Urgency;
  /** "overdue" | "within_24h" | "stale" | undefined */
  timeSensitivity?: 'overdue' | 'within_24h' | 'stale';
  /** "pilot_breach" | "allocation_unsafe" | "governance_failure" | "data_integrity" | undefined */
  riskImpact?: 'pilot_breach' | 'allocation_unsafe' | 'governance_failure' | 'data_integrity';
  /** True if this task gates downstream decisions. */
  blocking?: boolean;
  /** Number of times this rule/condition has recurred. */
  fireCount?: number;
}

export function scoreTask(input: ScoreInput): { score: number; factors: PriorityFactors } {
  let severity = 0;
  if (input.severity === 'critical') severity = 40;
  else if (input.severity === 'high') severity = 25;
  else if (input.severity === 'medium') severity = 10;
  else severity = 0; // low

  let timeSensitivity = 0;
  if (input.timeSensitivity === 'overdue') timeSensitivity = 30;
  else if (input.timeSensitivity === 'within_24h') timeSensitivity = 20;
  else if (input.timeSensitivity === 'stale') timeSensitivity = 15;

  let riskImpact = 0;
  if (input.riskImpact === 'pilot_breach') riskImpact = 30;
  else if (input.riskImpact === 'allocation_unsafe') riskImpact = 25;
  else if (input.riskImpact === 'governance_failure') riskImpact = 20;
  else if (input.riskImpact === 'data_integrity') riskImpact = 15;

  const dependency = input.blocking ? 20 : 0;
  const recurrence = (input.fireCount ?? 0) >= 3 ? 10 : 0;

  const raw = severity + timeSensitivity + riskImpact + dependency + recurrence;
  const score = Math.min(100, Math.max(0, raw));

  return {
    score,
    factors: { severity, timeSensitivity, riskImpact, dependency, recurrence, raw },
  };
}

function tierForScore(score: number): Tier {
  if (score >= 80) return 'critical_now';
  if (score >= 60) return 'today';
  if (score >= 40) return 'soon';
  return 'backlog';
}

function urgencyFromAction(p: ActionPriority): Urgency { return p; }
function urgencyFromAlert(s: ScorecardAlert['severity']): Urgency { return s; }
function categoryFromAction(c: ActionCategory): Category { return c; }

// ── Source: scorecard topActions ────────────────────────────────────────────

function fromScorecardActions(sc: StrategyScorecard): DeskTask[] {
  const out: DeskTask[] = [];
  for (const a of sc.topActions) {
    const severity = urgencyFromAction(a.priority);
    const cat = categoryFromAction(a.category);

    const time: ScoreInput['timeSensitivity'] | undefined =
      a.id === 'gov:overdue-decisions' ? 'overdue' :
      a.id === 'ops:refresh-paper'     ? 'stale'   :
      undefined;

    const risk: ScoreInput['riskImpact'] | undefined =
      a.id.startsWith('pilot:breach')        ? 'pilot_breach'        :
      a.id === 'alloc:stress-critical'       ? 'allocation_unsafe'   :
      a.id === 'alloc:stress-caution'        ? 'allocation_unsafe'   :
      a.id === 'gov:overdue-decisions'       ? 'governance_failure'  :
      a.id.startsWith('gov:no-review')       ? 'governance_failure'  :
      undefined;

    const blocking =
      a.id === 'edge:insufficient-evidence' ||         // blocks promotion
      a.id === 'gov:pilot-ready-no-pilot'   ||         // blocks pilot launch
      a.id.startsWith('gov:no-review');                // blocks go/no-go

    const { score, factors } = scoreTask({
      severity, timeSensitivity: time, riskImpact: risk, blocking,
    });

    out.push({
      id: `sc:${a.id}`,
      priorityScore: score,
      urgency: severity,
      category: cat,
      title: a.title,
      description: a.description,
      link: a.link,
      source: 'scorecard',
      blocking,
      reason: `Scorecard top action — ${a.reason}`,
      dedupeKey: `action:${a.id}`,
      tier: tierForScore(score),
      factors,
    });
  }
  return out;
}

// ── Source: scorecard alerts (open / acknowledged) ──────────────────────────

function fromAlerts(alerts: ScorecardAlert[]): DeskTask[] {
  const out: DeskTask[] = [];
  for (const a of alerts) {
    if (a.status === 'resolved') continue;

    const severity = urgencyFromAlert(a.severity);

    const time: ScoreInput['timeSensitivity'] | undefined =
      a.ruleId === 'overdue-decisions' ? 'overdue' :
      a.ruleId === 'paper-stale'       ? 'stale'   :
      undefined;

    const risk: ScoreInput['riskImpact'] | undefined =
      a.ruleId === 'pilot-breach'         ? 'pilot_breach'        :
      a.ruleId === 'stress-verdict'       ? 'allocation_unsafe'   :
      a.ruleId === 'overdue-decisions'    ? 'governance_failure'  :
      a.ruleId === 'pilot-ready-no-pilot' ? 'governance_failure'  :
      undefined;

    const blocking = a.ruleId === 'pilot-ready-no-pilot' || a.ruleId === 'pilot-breach';

    const { score, factors } = scoreTask({
      severity,
      timeSensitivity: time,
      riskImpact: risk,
      blocking,
      fireCount: a.fireCount,
    });

    out.push({
      id: `alert:${a.id}`,
      priorityScore: score,
      urgency: severity,
      category: a.category,
      title: a.title,
      description: a.description,
      link: a.link,
      source: 'alert',
      blocking,
      reason: `${a.status === 'acknowledged' ? 'Acknowledged' : 'Open'} alert (${a.ruleKey}, fired ${a.fireCount}×)`,
      dedupeKey: `alert:${a.ruleKey}`,
      tier: tierForScore(score),
      factors,
      fireCount: a.fireCount,
    });
  }
  return out;
}

// ── Source: pilot decisions (overdue / open) ────────────────────────────────

function fromDecisions(decisions: DecisionRecord[]): DeskTask[] {
  const out: DeskTask[] = [];
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (const d of decisions) {
    if (d.status === 'completed' || d.status === 'cancelled') continue;

    const overdue = isOverdue(d, now);
    let time: ScoreInput['timeSensitivity'] | undefined;
    if (overdue) time = 'overdue';
    else if (d.dueDate) {
      const due = new Date(d.dueDate).getTime();
      if (!Number.isNaN(due) && due - now <= oneDayMs && due - now > 0) time = 'within_24h';
    }

    const severity: Urgency = overdue ? 'high' : (d.status === 'open' ? 'medium' : 'low');
    const blocking = true; // open decisions block follow-through

    const { score, factors } = scoreTask({
      severity,
      timeSensitivity: time,
      riskImpact: 'governance_failure',
      blocking,
    });

    out.push({
      id: `dec:${d.id}`,
      priorityScore: score,
      urgency: severity,
      category: 'governance',
      title: overdue
        ? `Overdue decision: ${d.decision} (${d.recommendation})`
        : `Open decision: ${d.decision} (${d.recommendation})`,
      description: d.plannedAction
        ? `Pilot ${d.pilotName ?? d.pilotId}: ${d.plannedAction}`
        : `Pilot ${d.pilotName ?? d.pilotId}: ${d.rationale.slice(0, 120)}`,
      link: '/admin/system/pilot-decisions',
      source: 'brief',
      deadlineHint: d.dueDate,
      blocking,
      reason: overdue
        ? `Decision ${d.id} past dueDate ${d.dueDate}`
        : `Decision ${d.id} status=${d.status}`,
      dedupeKey: `decision:${d.id}`,
      tier: tierForScore(score),
      factors,
    });
  }
  return out;
}

// ── Source: active pilots (breach / watch) ──────────────────────────────────

function fromPilots(pilots: PilotPlan[], monitoring: Map<string, PilotMonitoring>): DeskTask[] {
  const out: DeskTask[] = [];
  for (const p of pilots) {
    if (p.status !== 'active') continue;
    const m = monitoring.get(p.id);
    if (!m) continue;

    if (m.warningStatus === 'breach') {
      const { score, factors } = scoreTask({
        severity: 'critical',
        timeSensitivity: 'within_24h',
        riskImpact: 'pilot_breach',
        blocking: true,
      });
      out.push({
        id: `pilot:breach:${p.id}`,
        priorityScore: score,
        urgency: 'critical',
        category: 'pilot',
        title: `Active pilot in BREACH: ${p.strategyName}`,
        description: `Limits exceeded — ${m.breaches.slice(0, 2).join('; ')}${m.breaches.length > 2 ? '…' : ''}`,
        link: `/admin/system/strategy-pilot?pilotId=${encodeURIComponent(p.id)}`,
        source: 'scorecard',
        blocking: true,
        reason: `pilot monitoring reports ${m.breaches.length} breach(es)`,
        dedupeKey: `alert:pilot-breach:${p.id}`, // matches alert dedupe key
        tier: tierForScore(score),
        factors,
      });
    } else if (m.warningStatus === 'watch') {
      const { score, factors } = scoreTask({
        severity: 'high',
        riskImpact: 'pilot_breach',
        blocking: false,
      });
      out.push({
        id: `pilot:watch:${p.id}`,
        priorityScore: score,
        urgency: 'high',
        category: 'pilot',
        title: `Pilot in WATCH: ${p.strategyName}`,
        description: 'One or more limits at >75% utilization. Investigate before breach.',
        link: `/admin/system/strategy-pilot?pilotId=${encodeURIComponent(p.id)}`,
        source: 'scorecard',
        blocking: false,
        reason: 'utilization above watch threshold',
        dedupeKey: `pilot-watch:${p.id}`,
        tier: tierForScore(score),
        factors,
      });
    }
  }
  return out;
}

// ── Source: missing reviews on active pilots ────────────────────────────────

function fromMissingReviews(pilots: PilotPlan[], reviews: PilotReview[]): DeskTask[] {
  const out: DeskTask[] = [];
  const reviewedIds = new Set(reviews.map(r => r.pilotId));
  const draftReviews = reviews.filter(r => r.status === 'draft');

  for (const p of pilots) {
    if (p.status !== 'active') continue;
    if (reviewedIds.has(p.id)) continue;

    const { score, factors } = scoreTask({
      severity: 'high',
      riskImpact: 'governance_failure',
      blocking: true,
    });
    out.push({
      id: `review:missing:${p.id}`,
      priorityScore: score,
      urgency: 'high',
      category: 'governance',
      title: `Complete go/no-go review for active pilot: ${p.strategyName}`,
      description: 'Active pilot has never been reviewed. Generate a draft and complete it.',
      link: `/admin/system/pilot-review?pilotId=${encodeURIComponent(p.id)}`,
      source: 'scorecard',
      blocking: true,
      reason: 'no PilotReview record for this pilot',
      dedupeKey: `review-missing:${p.id}`,
      tier: tierForScore(score),
      factors,
    });
  }

  for (const r of draftReviews) {
    const { score, factors } = scoreTask({
      severity: 'medium',
      riskImpact: 'governance_failure',
      blocking: false,
    });
    out.push({
      id: `review:draft:${r.id}`,
      priorityScore: score,
      urgency: 'medium',
      category: 'governance',
      title: `Complete draft review for pilot: ${r.pilotName ?? r.pilotId}`,
      description: 'Draft reviews record analysis but do not produce a recommendation until completed.',
      link: '/admin/system/pilot-review',
      source: 'scorecard',
      blocking: false,
      reason: 'PilotReview.status === "draft"',
      dedupeKey: `review-draft:${r.id}`,
      tier: tierForScore(score),
      factors,
    });
  }

  return out;
}

// ── Dedupe (keep highest priorityScore per dedupeKey) ───────────────────────

function dedupe(tasks: DeskTask[]): DeskTask[] {
  const map = new Map<string, DeskTask>();
  for (const t of tasks) {
    const existing = map.get(t.dedupeKey);
    if (!existing || t.priorityScore > existing.priorityScore) {
      map.set(t.dedupeKey, t);
    }
  }
  return Array.from(map.values());
}

// ── Summary ─────────────────────────────────────────────────────────────────

function buildSummary(queue: DeskTask[]): DeskQueueSummary {
  const byTier: Record<Tier, number> = { critical_now: 0, today: 0, soon: 0, backlog: 0 };
  const byUrgency: Record<Urgency, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory: Record<Category, number> = { edge: 0, allocation: 0, pilot: 0, governance: 0, ops: 0 };
  const bySource: Record<TaskSource, number> = { scorecard: 0, alert: 0, brief: 0 };
  let blockingCount = 0;
  let overdueCount = 0;
  let topPriorityScore = 0;

  for (const t of queue) {
    byTier[t.tier]++;
    byUrgency[t.urgency]++;
    byCategory[t.category]++;
    bySource[t.source]++;
    if (t.blocking) blockingCount++;
    if (t.factors.timeSensitivity === 30) overdueCount++;
    if (t.priorityScore > topPriorityScore) topPriorityScore = t.priorityScore;
  }

  return { total: queue.length, byTier, byUrgency, byCategory, bySource, blockingCount, overdueCount, topPriorityScore };
}

// ── Main builder ────────────────────────────────────────────────────────────

export async function buildDeskQueue(): Promise<DeskQueue> {
  const [sc, alerts, decisions, pilots, reviews] = await Promise.all([
    buildScorecard(),
    listAlerts(500),
    listDecisions(2000),
    listPilots(200),
    listReviews(500),
  ]);

  // Pilot monitoring snapshots (only active to keep this fast)
  const monitoring = new Map<string, PilotMonitoring>();
  await Promise.all(
    pilots.filter(p => p.status === 'active').map(async p => {
      try {
        monitoring.set(p.id, await computePilotMonitoring(p));
      } catch { /* skip individual failures */ }
    }),
  );

  const all = [
    ...fromScorecardActions(sc),
    ...fromAlerts(alerts),
    ...fromDecisions(decisions),
    ...fromPilots(pilots, monitoring),
    ...fromMissingReviews(pilots, reviews),
  ];

  const queue = dedupe(all).sort((a, b) => b.priorityScore - a.priorityScore);
  const byTier: Record<Tier, DeskTask[]> = { critical_now: [], today: [], soon: [], backlog: [] };
  for (const t of queue) byTier[t.tier].push(t);

  return {
    generatedAt: new Date().toISOString(),
    queue,
    byTier,
    summary: buildSummary(queue),
  };
}
