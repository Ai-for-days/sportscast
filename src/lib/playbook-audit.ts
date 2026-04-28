// ── Step 91: Playbook compliance + execution quality audit ──────────────────
//
// Read-only audit over the Step 90 manual playbook runs. Measures whether
// operators are completing required items, linking candidates / orders /
// pilots, and whether playbook-compliant runs correlate with better
// outcomes. Never trades, never submits orders, never creates execution
// candidates, never changes execution behavior.

import {
  listRuns,
  type PlaybookRun, type PlaybookItem, type RunStatus, type RunMode, type ItemStatus,
} from './execution-playbook';
import { listLedgerEntries, type LedgerEntry } from './pnl-ledger';

// ── Types ───────────────────────────────────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AuditTotals {
  total: number;
  open: number;
  completed: number;
  cancelled: number;
  byMode: Record<RunMode, number>;
}

export interface RequiredItemStats {
  /** Total required-item slots across all runs (each run contributes its required count). */
  totalRequiredSlots: number;
  /** Required items in status === 'completed'. */
  completedRequired: number;
  /** Required items in status === 'skipped'. */
  skippedRequired: number;
  /** Skipped required items that have a non-empty note. */
  skippedRequiredWithNote: number;
  /** Required items still pending (open runs only). */
  pendingRequired: number;
  /** Required items in status === 'blocked'. */
  blockedRequired: number;
  /** completedRequired / totalRequiredSlots as percent. */
  completionPct: number;
}

export interface LinkStats {
  /** Mode in {demo, live} runs that should plausibly have a candidate link. */
  applicableForCandidate: number;
  candidateLinked: number;
  candidateMissing: number;
  applicableForOrder: number;
  orderLinked: number;
  orderMissing: number;
  /** Pilot is optional — we just count linked vs not. */
  pilotLinked: number;
  pilotMissing: number;
}

export interface OutcomeStats {
  /** Completed runs with an order linked. */
  completedWithOrder: number;
  /** Completed runs without an order linked. */
  completedWithoutOrder: number;
  /** Aggregate realized P&L (cents) for completed runs whose linked orderId hits the ledger. */
  pnlCents: number;
  /** Number of completed runs whose orderId actually matched a ledger entry. */
  pnlMatchedRuns: number;
  /** Aggregate cents broken out by run mode. */
  pnlByMode: Record<RunMode, number>;
}

export interface FrictionPoint {
  /** Stable item title (default checklist titles are stable). */
  title: string;
  category: PlaybookItem['category'];
  required: boolean;
  blockedCount: number;
  skippedCount: number;
  /** Percent of times this title appeared blocked or skipped across all runs. */
  frictionPct: number;
}

export interface OperatorStats {
  operatorId: string;
  total: number;
  completed: number;
  cancelled: number;
  open: number;
  completionPct: number;
  averageTimeToCompleteMs: number | null;
}

export interface BlockedItemRow {
  runId: string;
  signalId: string;
  mode: RunMode;
  category: PlaybookItem['category'];
  title: string;
  required: boolean;
  status: ItemStatus;       // blocked or skipped
  notes?: string;
}

export interface StaleOpenRow {
  runId: string;
  signalId: string;
  mode: RunMode;
  operatorId: string;
  ageMs: number;
  pendingRequired: number;
  blockers: number;
  candidateId?: string;
  orderId?: string;
}

export interface ComplianceFactors {
  requiredCompletionPoints: number;       // 0..30
  candidateLinkPoints: number;            // 0..15
  orderLinkPoints: number;                // 0..15
  pilotLinkPoints: number;                // 0..10
  skipNotePoints: number;                 // 0..10
  blockedPenalty: number;                 // -20..0
  stalePenalty: number;                   // -15..0
  thinCancelPenalty: number;              // -10..0
  raw: number;                            // sum (pre-cap)
}

export interface ComplianceScore {
  score: number;        // 0..100
  grade: Grade;
  factors: ComplianceFactors;
  reasons: string[];    // human-readable explanations
}

export interface PlaybookAudit {
  generatedAt: string;
  totals: AuditTotals;
  required: RequiredItemStats;
  links: LinkStats;
  outcomes: OutcomeStats;
  frictionPoints: FrictionPoint[];
  blockedItems: BlockedItemRow[];
  skippedItems: BlockedItemRow[];
  staleOpen: StaleOpenRow[];
  operators: OperatorStats[];
  averageTimeToCompleteMs: number | null;
  compliance: ComplianceScore;
  notes: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const STALE_OPEN_AGE_MS = 24 * 60 * 60 * 1000;     // 24h
const THIN_CANCEL_REASON_CHARS = 20;                // <20 chars = "thin"

function gradeOf(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function clamp(n: number, lo = 0, hi = 100): number { return Math.max(lo, Math.min(hi, n)); }

// ── Computation ─────────────────────────────────────────────────────────────

function computeTotals(runs: PlaybookRun[]): AuditTotals {
  const byMode: Record<RunMode, number> = { paper: 0, demo: 0, live: 0 };
  let open = 0, completed = 0, cancelled = 0;
  for (const r of runs) {
    byMode[r.mode]++;
    if (r.status === 'open') open++;
    else if (r.status === 'completed') completed++;
    else if (r.status === 'cancelled') cancelled++;
  }
  return { total: runs.length, open, completed, cancelled, byMode };
}

function computeRequiredStats(runs: PlaybookRun[]): RequiredItemStats {
  let totalRequiredSlots = 0;
  let completedRequired = 0;
  let skippedRequired = 0;
  let skippedRequiredWithNote = 0;
  let pendingRequired = 0;
  let blockedRequired = 0;
  for (const r of runs) {
    for (const i of r.checklist) {
      if (!i.required) continue;
      totalRequiredSlots++;
      if (i.status === 'completed') completedRequired++;
      else if (i.status === 'skipped') {
        skippedRequired++;
        if (i.notes && i.notes.trim()) skippedRequiredWithNote++;
      } else if (i.status === 'blocked') blockedRequired++;
      else if (i.status === 'pending' && r.status === 'open') pendingRequired++;
    }
  }
  const completionPct = totalRequiredSlots === 0 ? 0 : Math.round((completedRequired / totalRequiredSlots) * 1000) / 10;
  return { totalRequiredSlots, completedRequired, skippedRequired, skippedRequiredWithNote, pendingRequired, blockedRequired, completionPct };
}

function computeLinkStats(runs: PlaybookRun[]): LinkStats {
  let applicableForCandidate = 0;
  let candidateLinked = 0;
  let applicableForOrder = 0;
  let orderLinked = 0;
  let pilotLinked = 0;
  let pilotMissing = 0;

  for (const r of runs) {
    // Candidate / order are only "applicable" for demo + live runs that completed
    // (paper runs may legitimately have neither). For open runs we still count
    // them as applicable so the score reflects in-progress hygiene.
    if (r.mode === 'demo' || r.mode === 'live') {
      applicableForCandidate++;
      if (r.candidateId) candidateLinked++;
      applicableForOrder++;
      if (r.orderId) orderLinked++;
    }
    if (r.pilotId) pilotLinked++;
    else pilotMissing++;
  }

  return {
    applicableForCandidate,
    candidateLinked,
    candidateMissing: applicableForCandidate - candidateLinked,
    applicableForOrder,
    orderLinked,
    orderMissing: applicableForOrder - orderLinked,
    pilotLinked,
    pilotMissing,
  };
}

function computeOutcomes(runs: PlaybookRun[], ledger: LedgerEntry[]): OutcomeStats {
  const completed = runs.filter(r => r.status === 'completed');
  const withOrder = completed.filter(r => !!r.orderId);
  const withoutOrder = completed.length - withOrder.length;

  const ledgerByOrder = new Map<string, number>();
  for (const e of ledger) {
    if (!e.orderId || !e.realized) continue;
    ledgerByOrder.set(e.orderId, (ledgerByOrder.get(e.orderId) ?? 0) + (e.amountCents ?? 0));
  }

  let pnlCents = 0;
  let pnlMatchedRuns = 0;
  const pnlByMode: Record<RunMode, number> = { paper: 0, demo: 0, live: 0 };
  for (const r of withOrder) {
    if (!r.orderId) continue;
    if (ledgerByOrder.has(r.orderId)) {
      const cents = ledgerByOrder.get(r.orderId)!;
      pnlCents += cents;
      pnlByMode[r.mode] += cents;
      pnlMatchedRuns++;
    }
  }

  return {
    completedWithOrder: withOrder.length,
    completedWithoutOrder: withoutOrder,
    pnlCents,
    pnlMatchedRuns,
    pnlByMode,
  };
}

function computeFriction(runs: PlaybookRun[]): FrictionPoint[] {
  // Aggregate by (title) — default checklist titles are stable per Step 90.
  const map = new Map<string, FrictionPoint>();
  let totalItems = 0;

  for (const r of runs) {
    for (const i of r.checklist) {
      totalItems++;
      const key = i.title;
      let fp = map.get(key);
      if (!fp) {
        fp = { title: i.title, category: i.category, required: i.required, blockedCount: 0, skippedCount: 0, frictionPct: 0 };
        map.set(key, fp);
      }
      if (i.status === 'blocked') fp.blockedCount++;
      else if (i.status === 'skipped') fp.skippedCount++;
    }
  }

  const arr = Array.from(map.values()).map(fp => ({
    ...fp,
    frictionPct: totalItems === 0 ? 0 : Math.round(((fp.blockedCount + fp.skippedCount) / totalItems) * 10000) / 100,
  }));

  // Only return the ones that have any friction, sorted desc
  return arr.filter(fp => fp.blockedCount + fp.skippedCount > 0)
    .sort((a, b) => (b.blockedCount + b.skippedCount) - (a.blockedCount + a.skippedCount));
}

function collectBlocked(runs: PlaybookRun[]): { blocked: BlockedItemRow[]; skipped: BlockedItemRow[] } {
  const blocked: BlockedItemRow[] = [];
  const skipped: BlockedItemRow[] = [];
  for (const r of runs) {
    for (const i of r.checklist) {
      if (i.status === 'blocked') {
        blocked.push({ runId: r.id, signalId: r.signalId, mode: r.mode, category: i.category, title: i.title, required: i.required, status: 'blocked', notes: i.notes });
      } else if (i.status === 'skipped') {
        skipped.push({ runId: r.id, signalId: r.signalId, mode: r.mode, category: i.category, title: i.title, required: i.required, status: 'skipped', notes: i.notes });
      }
    }
  }
  return { blocked, skipped };
}

function collectStaleOpen(runs: PlaybookRun[]): StaleOpenRow[] {
  const now = Date.now();
  const out: StaleOpenRow[] = [];
  for (const r of runs) {
    if (r.status !== 'open') continue;
    const ageMs = now - new Date(r.createdAt).getTime();
    if (ageMs < STALE_OPEN_AGE_MS) continue;
    const pendingRequired = r.checklist.filter(i => i.required && i.status === 'pending').length;
    const blockers = r.checklist.filter(i => i.status === 'blocked').length;
    out.push({
      runId: r.id, signalId: r.signalId, mode: r.mode, operatorId: r.operatorId,
      ageMs, pendingRequired, blockers,
      candidateId: r.candidateId, orderId: r.orderId,
    });
  }
  return out.sort((a, b) => b.ageMs - a.ageMs);
}

function computeOperatorStats(runs: PlaybookRun[]): OperatorStats[] {
  const map = new Map<string, { total: number; completed: number; cancelled: number; open: number; durations: number[] }>();
  for (const r of runs) {
    let s = map.get(r.operatorId);
    if (!s) { s = { total: 0, completed: 0, cancelled: 0, open: 0, durations: [] }; map.set(r.operatorId, s); }
    s.total++;
    if (r.status === 'completed') {
      s.completed++;
      if (r.completedAt) {
        const dur = new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime();
        if (Number.isFinite(dur) && dur >= 0) s.durations.push(dur);
      }
    } else if (r.status === 'cancelled') s.cancelled++;
    else if (r.status === 'open') s.open++;
  }
  return Array.from(map.entries()).map(([operatorId, s]) => ({
    operatorId,
    total: s.total,
    completed: s.completed,
    cancelled: s.cancelled,
    open: s.open,
    completionPct: s.total === 0 ? 0 : Math.round((s.completed / s.total) * 1000) / 10,
    averageTimeToCompleteMs: s.durations.length === 0 ? null : Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length),
  })).sort((a, b) => b.total - a.total);
}

function computeAverageTimeToComplete(runs: PlaybookRun[]): number | null {
  const durations: number[] = [];
  for (const r of runs) {
    if (r.status !== 'completed' || !r.completedAt) continue;
    const dur = new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime();
    if (Number.isFinite(dur) && dur >= 0) durations.push(dur);
  }
  return durations.length === 0 ? null : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

// ── Compliance scoring ──────────────────────────────────────────────────────

function computeCompliance(input: {
  required: RequiredItemStats;
  links: LinkStats;
  staleOpen: StaleOpenRow[];
  totals: AuditTotals;
  runs: PlaybookRun[];
}): ComplianceScore {
  const { required, links, staleOpen, totals, runs } = input;
  const reasons: string[] = [];

  // + Required completion (up to 30): completionPct -> proportional, but only
  // counts completed runs' required items via completionPct on the whole pool.
  let requiredCompletionPoints = 0;
  if (required.totalRequiredSlots > 0) {
    requiredCompletionPoints = Math.round((required.completionPct / 100) * 30);
    reasons.push(`Required-item completion ${required.completionPct}% → +${requiredCompletionPoints}/30`);
  } else {
    reasons.push('No required items recorded yet');
  }

  // + Candidate-link rate (up to 15)
  let candidateLinkPoints = 0;
  if (links.applicableForCandidate > 0) {
    const ratio = links.candidateLinked / links.applicableForCandidate;
    candidateLinkPoints = Math.round(ratio * 15);
    reasons.push(`Candidate-link rate ${(ratio * 100).toFixed(0)}% (${links.candidateLinked}/${links.applicableForCandidate}) → +${candidateLinkPoints}/15`);
  } else {
    reasons.push('No demo/live runs requiring candidate link yet');
  }

  // + Order-link rate (up to 15)
  let orderLinkPoints = 0;
  if (links.applicableForOrder > 0) {
    const ratio = links.orderLinked / links.applicableForOrder;
    orderLinkPoints = Math.round(ratio * 15);
    reasons.push(`Order-link rate ${(ratio * 100).toFixed(0)}% (${links.orderLinked}/${links.applicableForOrder}) → +${orderLinkPoints}/15`);
  }

  // + Pilot-link rate (up to 10) — only credits when a pilot was linked
  // (since pilot is optional, we cap at 10 of total runs that did link pilot).
  let pilotLinkPoints = 0;
  if (totals.total > 0) {
    const ratio = links.pilotLinked / totals.total;
    pilotLinkPoints = Math.round(ratio * 10);
    reasons.push(`Pilot-link rate ${(ratio * 100).toFixed(0)}% (${links.pilotLinked}/${totals.total}) → +${pilotLinkPoints}/10`);
  }

  // + Skip-with-note rate (up to 10)
  let skipNotePoints = 0;
  if (required.skippedRequired > 0) {
    const ratio = required.skippedRequiredWithNote / required.skippedRequired;
    skipNotePoints = Math.round(ratio * 10);
    reasons.push(`Skipped-required notes ${(ratio * 100).toFixed(0)}% (${required.skippedRequiredWithNote}/${required.skippedRequired}) → +${skipNotePoints}/10`);
  } else {
    // Bonus if no skipped required items at all
    skipNotePoints = 10;
    reasons.push('No skipped required items → +10/10');
  }

  // − Blocked-item penalty (up to -20) — scales with blocked-required count
  let blockedPenalty = 0;
  if (required.blockedRequired > 0) {
    blockedPenalty = -Math.min(20, required.blockedRequired * 4);
    reasons.push(`Blocked required items penalty (${required.blockedRequired}) → ${blockedPenalty}/-20`);
  }

  // − Stale open penalty (up to -15) — based on stale-open count
  let stalePenalty = 0;
  if (staleOpen.length > 0) {
    stalePenalty = -Math.min(15, staleOpen.length * 5);
    reasons.push(`Stale open playbooks penalty (${staleOpen.length}) → ${stalePenalty}/-15`);
  }

  // − Thin-cancel penalty (up to -10) — cancellations with reason < 20 chars
  let thinCancelPenalty = 0;
  const thinCancels = runs.filter(r => r.status === 'cancelled' && (!r.cancelReason || r.cancelReason.trim().length < THIN_CANCEL_REASON_CHARS)).length;
  if (thinCancels > 0) {
    thinCancelPenalty = -Math.min(10, thinCancels * 5);
    reasons.push(`Thin-cancellation reasons penalty (${thinCancels}) → ${thinCancelPenalty}/-10`);
  }

  const raw = requiredCompletionPoints + candidateLinkPoints + orderLinkPoints
            + pilotLinkPoints + skipNotePoints
            + blockedPenalty + stalePenalty + thinCancelPenalty;

  // Baseline of 20 for "having a playbook program at all". Without it, a fresh
  // installation reads as F even though no operator has misbehaved.
  const baseline = totals.total > 0 ? 20 : 0;
  const score = clamp(raw + baseline);

  return {
    score,
    grade: gradeOf(score),
    factors: {
      requiredCompletionPoints,
      candidateLinkPoints,
      orderLinkPoints,
      pilotLinkPoints,
      skipNotePoints,
      blockedPenalty,
      stalePenalty,
      thinCancelPenalty,
      raw,
    },
    reasons,
  };
}

// ── Main builder ────────────────────────────────────────────────────────────

export async function buildAudit(): Promise<PlaybookAudit> {
  const [runs, ledger] = await Promise.all([
    listRuns(500),
    listLedgerEntries(2000).catch(() => [] as LedgerEntry[]),
  ]);

  const totals = computeTotals(runs);
  const required = computeRequiredStats(runs);
  const links = computeLinkStats(runs);
  const outcomes = computeOutcomes(runs, ledger);
  const frictionPoints = computeFriction(runs);
  const { blocked, skipped } = collectBlocked(runs);
  const staleOpen = collectStaleOpen(runs);
  const operators = computeOperatorStats(runs);
  const averageTimeToCompleteMs = computeAverageTimeToComplete(runs);
  const compliance = computeCompliance({ required, links, staleOpen, totals, runs });

  return {
    generatedAt: new Date().toISOString(),
    totals,
    required,
    links,
    outcomes,
    frictionPoints,
    blockedItems: blocked,
    skippedItems: skipped,
    staleOpen,
    operators,
    averageTimeToCompleteMs,
    compliance,
    notes: [
      'Audit is read-only. No autonomous trading, no order submission, no candidate auto-creation, no execution-behavior changes.',
      `Stale-open threshold: ${STALE_OPEN_AGE_MS / (60 * 60 * 1000)}h. Thin cancel reason threshold: <${THIN_CANCEL_REASON_CHARS} chars.`,
      'P&L lookups are best-effort: only matched when the linked orderId hits the realized PnL ledger.',
      'Compliance score = (sum of factor points, capped at 100) + 20-point baseline once any playbook exists. Grades: A≥90, B≥75, C≥60, D≥40, else F.',
    ],
  };
}
