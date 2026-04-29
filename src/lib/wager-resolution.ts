// ── Step 98: Wager Outcome Resolution & Grading Center ───────────────────────
//
// Manual grading workflow. Operators inspect a locked wager, enter the
// observed value(s), generate a non-persisting preview, and only then
// commit a grade or void. Nothing here moves money, settles user balances,
// closes markets beyond the existing lock behavior, or creates orders.
// Already-graded wagers cannot be re-graded — the existing wager-store
// helpers enforce that and we surface a clear warning.

import { logAuditEvent, listAuditEvents, type AuditEvent } from './audit-log';
import {
  listAllWagers, getWager, gradeWager, voidWager,
} from './wager-store';
import type {
  Wager, OddsWager, OverUnderWager, PointspreadWager, WagerKind,
} from './wager-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ResolutionConfidence = 'high' | 'medium' | 'low';

export interface ObservedInputOdds {
  /** The observed value of the metric (temperature in °F, wind in mph, etc). */
  observedValue: number;
}
export interface ObservedInputOverUnder {
  observedValue: number;
}
export interface ObservedInputPointspread {
  observedValueA: number;
  observedValueB: number;
}
export type ObservedInput = ObservedInputOdds | ObservedInputOverUnder | ObservedInputPointspread;

export interface ResolutionPreview {
  wagerId: string;
  generatedAt: string;
  generatedBy: string;
  wagerKind: WagerKind;
  metric: string;
  targetDate: string;
  observedInput: ObservedInput | null;
  /** Either an outcome label (odds/over-under/pointspread) or null on tie/missing data. */
  computedWinner: string | null;
  confidence: ResolutionConfidence;
  warnings: string[];
  explanation: string[];
  /** Always 'graded' when grading would proceed; 'void' when explicitly previewing a void; null when blocked. */
  wouldChangeStatusTo: 'graded' | 'void' | null;
  /** Echo of the source wager status so the UI can warn if already terminal. */
  sourceStatus: string;
}

export interface ResolvableSummary {
  id: string;
  ticketNumber: string;
  title: string;
  kind: WagerKind;
  metric: string;
  targetDate: string;
  targetTime?: string;
  status: string;
  lockTime: string;
  /** True if status is 'open' AND lockTime has passed (operator should still grade). */
  pastLockTime: boolean;
  locationSummary: string;
}

export interface ResolutionHistoryEntry {
  id: string;
  createdAt: string;
  actor: string;
  eventType: string;
  summary: string;
  details?: any;
}

export class WagerResolutionError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function locationSummaryOf(w: Wager): string {
  if (w.kind === 'pointspread') return `${w.locationA?.name ?? '?'} vs ${w.locationB?.name ?? '?'}`;
  return (w as OddsWager | OverUnderWager).location?.name ?? '?';
}

function isResolvable(w: Wager): boolean {
  if (w.status === 'graded' || w.status === 'void' || w.status === 'cancelled' as any) return false;
  return true;
}

// ── Listing ──────────────────────────────────────────────────────────────────

/**
 * Wagers eligible for grading: anything not already graded/voided. Includes
 * still-`open` wagers whose lockTime has passed (a good sign the operator
 * should review).
 */
export async function listResolvableWagers(limit = 200): Promise<ResolvableSummary[]> {
  const all = await listAllWagers(limit);
  const now = Date.now();
  const out: ResolvableSummary[] = [];
  for (const w of all) {
    if (!isResolvable(w)) continue;
    const lockMs = new Date(w.lockTime).getTime();
    out.push({
      id: w.id,
      ticketNumber: w.ticketNumber,
      title: w.title,
      kind: w.kind,
      metric: w.metric,
      targetDate: w.targetDate,
      targetTime: w.targetTime,
      status: w.status,
      lockTime: w.lockTime,
      pastLockTime: w.status === 'open' && Number.isFinite(lockMs) && lockMs < now,
      locationSummary: locationSummaryOf(w),
    });
  }
  // Sort: locked first, then past-lock open, then upcoming
  out.sort((a, b) => {
    const rank = (r: ResolvableSummary) => r.status === 'locked' ? 0 : r.pastLockTime ? 1 : 2;
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.targetDate.localeCompare(b.targetDate);
  });
  return out;
}

// ── Per-kind winner computation ──────────────────────────────────────────────

interface ComputeResult {
  winner: string | null;
  confidence: ResolutionConfidence;
  warnings: string[];
  explanation: string[];
}

function computeOdds(w: OddsWager, obs: ObservedInputOdds): ComputeResult {
  const out: ComputeResult = { winner: null, confidence: 'low', warnings: [], explanation: [] };
  if (!Number.isFinite(obs.observedValue)) {
    out.warnings.push('observedValue is missing or not numeric.');
    return out;
  }
  const v = obs.observedValue;
  out.explanation.push(`Observed ${w.metric} = ${v}.`);

  // Match the outcome whose [minValue, maxValue] range contains v (inclusive).
  const matches = (w.outcomes ?? []).filter(o => v >= o.minValue && v <= o.maxValue);

  if (matches.length === 0) {
    out.warnings.push(`Observed value ${v} does not fall inside any defined outcome range — wager may need to be voided.`);
    out.explanation.push('No outcome range contains the observed value.');
    return out;
  }
  if (matches.length > 1) {
    out.warnings.push(`Observed value ${v} matches ${matches.length} overlapping outcomes — outcome ranges overlap. Resolve the overlap before grading.`);
    out.explanation.push(`Multiple outcomes match: ${matches.map(m => `"${m.label}"`).join(', ')}.`);
    out.confidence = 'low';
    return out;
  }

  out.winner = matches[0].label;
  out.explanation.push(`Observed value falls inside outcome "${matches[0].label}" (${matches[0].minValue} … ${matches[0].maxValue}).`);

  // Confidence: distance from boundary
  const m = matches[0];
  const range = Math.max(0.0001, m.maxValue - m.minValue);
  const distFromMin = Math.abs(v - m.minValue);
  const distFromMax = Math.abs(v - m.maxValue);
  const minDist = Math.min(distFromMin, distFromMax);
  const ratio = minDist / range;
  if (ratio < 0.05) {
    out.confidence = 'medium';
    out.warnings.push(`Observed value is within 5% of an outcome boundary (${(ratio * 100).toFixed(1)}% of range). Verify the data source.`);
  } else if (ratio < 0.15) {
    out.confidence = 'medium';
    out.explanation.push(`Within 15% of outcome boundary — confidence reduced to medium.`);
  } else {
    out.confidence = 'high';
  }
  return out;
}

function computeOverUnder(w: OverUnderWager, obs: ObservedInputOverUnder): ComputeResult {
  const out: ComputeResult = { winner: null, confidence: 'low', warnings: [], explanation: [] };
  if (!Number.isFinite(obs.observedValue)) {
    out.warnings.push('observedValue is missing or not numeric.');
    return out;
  }
  if (!Number.isFinite(w.line)) {
    out.warnings.push('Wager has no numeric line — wager may be malformed.');
    return out;
  }
  const v = obs.observedValue;
  out.explanation.push(`Line: ${w.line}; observed: ${v}.`);

  if (v > w.line) {
    out.winner = 'over';
    out.explanation.push(`Observed (${v}) > line (${w.line}) → over wins.`);
  } else if (v < w.line) {
    out.winner = 'under';
    out.explanation.push(`Observed (${v}) < line (${w.line}) → under wins.`);
  } else {
    out.warnings.push(`Observed value equals the line exactly (${v} = ${w.line}) — push. The current wager model has no push outcome; consider voiding the wager.`);
    out.explanation.push('Exact tie at the line — manual review required.');
    out.confidence = 'low';
    return out;
  }

  // Confidence by margin
  const marginPct = Math.abs(v - w.line) / Math.max(0.0001, Math.abs(w.line));
  if (marginPct < 0.01) {
    out.confidence = 'medium';
    out.warnings.push(`Margin is very small (${(marginPct * 100).toFixed(2)}% of line). Verify the data source.`);
  } else if (marginPct < 0.05) {
    out.confidence = 'medium';
  } else {
    out.confidence = 'high';
  }
  return out;
}

function computePointspread(w: PointspreadWager, obs: ObservedInputPointspread): ComputeResult {
  const out: ComputeResult = { winner: null, confidence: 'low', warnings: [], explanation: [] };
  if (!Number.isFinite(obs.observedValueA) || !Number.isFinite(obs.observedValueB)) {
    out.warnings.push('Both observedValueA and observedValueB are required.');
    return out;
  }
  if (!Number.isFinite(w.spread)) {
    out.warnings.push('Wager has no numeric spread — wager may be malformed.');
    return out;
  }

  const observedDiff = obs.observedValueA - obs.observedValueB;
  out.explanation.push(`${w.locationA?.name ?? 'A'} − ${w.locationB?.name ?? 'B'}: observed diff ${observedDiff} vs spread ${w.spread}.`);

  if (observedDiff > w.spread) {
    out.winner = 'locationA';
    out.explanation.push(`Observed diff (${observedDiff}) > spread (${w.spread}) → locationA wins.`);
  } else if (observedDiff < w.spread) {
    out.winner = 'locationB';
    out.explanation.push(`Observed diff (${observedDiff}) < spread (${w.spread}) → locationB wins.`);
  } else {
    out.warnings.push(`Observed difference equals the spread exactly (${observedDiff} = ${w.spread}) — push. Consider voiding.`);
    out.explanation.push('Exact tie at the spread — manual review required.');
    out.confidence = 'low';
    return out;
  }

  const margin = Math.abs(observedDiff - w.spread);
  if (margin < 1) {
    out.confidence = 'medium';
    out.warnings.push(`Margin (${margin.toFixed(2)}) is less than 1 unit. Verify the data source.`);
  } else if (margin < 3) {
    out.confidence = 'medium';
  } else {
    out.confidence = 'high';
  }
  return out;
}

// ── Preview ──────────────────────────────────────────────────────────────────

export async function generateResolutionPreview(
  wagerId: string,
  actor: string,
  observedInput: ObservedInput | null,
): Promise<ResolutionPreview> {
  if (!actor) throw new WagerResolutionError('actor is required', 'actor_required');
  const wager = await getWager(wagerId);
  if (!wager) throw new WagerResolutionError('Wager not found', 'wager_not_found');

  const baseWarnings: string[] = [];
  const baseExplanation: string[] = [];

  // Block previews for terminal states with a clear message
  if (wager.status === 'graded') {
    baseWarnings.push('Wager is already graded — re-grading is not supported by the wager store.');
  } else if (wager.status === 'void') {
    baseWarnings.push('Wager is already voided — cannot grade.');
  }

  // Past target date is a soft check
  const todayStr = new Date().toISOString().slice(0, 10);
  if (wager.targetDate > todayStr) {
    baseWarnings.push(`Target date (${wager.targetDate}) is in the future — confirm the observed value really resolves this wager before grading.`);
  } else if (wager.targetDate === todayStr) {
    baseExplanation.push(`Target date is today (${wager.targetDate}).`);
  } else {
    baseExplanation.push(`Target date is in the past (${wager.targetDate}).`);
  }

  // Lock-time hint
  const lockMs = new Date(wager.lockTime).getTime();
  if (Number.isFinite(lockMs) && lockMs > Date.now() && wager.status === 'open') {
    baseWarnings.push(`Wager has not reached its lock time yet (${wager.lockTime}). Consider waiting unless you are correcting an error.`);
  }

  // Compute winner per kind, only if observedInput present
  let kindResult: ComputeResult = { winner: null, confidence: 'low', warnings: [], explanation: [] };
  if (observedInput == null) {
    kindResult.warnings.push('No observed input provided — preview only. Enter observed values to compute a winner.');
  } else if (wager.kind === 'odds') {
    kindResult = computeOdds(wager, observedInput as ObservedInputOdds);
  } else if (wager.kind === 'over-under') {
    kindResult = computeOverUnder(wager, observedInput as ObservedInputOverUnder);
  } else if (wager.kind === 'pointspread') {
    kindResult = computePointspread(wager, observedInput as ObservedInputPointspread);
  }

  const allWarnings = [...baseWarnings, ...kindResult.warnings];
  const explanation = [...baseExplanation, ...kindResult.explanation];

  // Decide if grading would proceed
  const blockedByStatus = wager.status === 'graded' || wager.status === 'void';
  const canGrade = !blockedByStatus && kindResult.winner != null;

  const preview: ResolutionPreview = {
    wagerId,
    generatedAt: new Date().toISOString(),
    generatedBy: actor,
    wagerKind: wager.kind,
    metric: wager.metric,
    targetDate: wager.targetDate,
    observedInput,
    computedWinner: kindResult.winner,
    confidence: kindResult.confidence,
    warnings: allWarnings,
    explanation,
    wouldChangeStatusTo: canGrade ? 'graded' : null,
    sourceStatus: wager.status,
  };

  await logAuditEvent({
    actor,
    eventType: 'wager_resolution_preview_generated',
    targetType: 'wager',
    targetId: wagerId,
    summary: `Resolution preview for wager ${wagerId} (${wager.kind}): winner=${kindResult.winner ?? 'none'} conf=${kindResult.confidence}`,
    details: {
      wagerId, kind: wager.kind, status: wager.status,
      observedInput, winner: kindResult.winner, confidence: kindResult.confidence,
      warningCount: allWarnings.length, wouldChangeStatusTo: preview.wouldChangeStatusTo,
    },
  });

  return preview;
}

// ── Manual grade ─────────────────────────────────────────────────────────────

export async function manuallyGradeWager(
  wagerId: string,
  actor: string,
  observedInput: ObservedInput,
  note?: string,
): Promise<Wager> {
  if (!actor) throw new WagerResolutionError('actor is required', 'actor_required');
  if (!observedInput) throw new WagerResolutionError('observedInput is required', 'observed_input_required');

  const wager = await getWager(wagerId);
  if (!wager) throw new WagerResolutionError('Wager not found', 'wager_not_found');
  if (wager.status === 'graded') {
    throw new WagerResolutionError('Wager is already graded — re-grading is blocked.', 'already_graded');
  }
  if (wager.status === 'void') {
    throw new WagerResolutionError('Wager is voided — grading is blocked.', 'already_voided');
  }

  // Recompute the winner server-side (never trust caller-supplied winner).
  let result: ComputeResult;
  let observedValueForStore: number;
  let extra: Partial<Wager> | undefined;
  if (wager.kind === 'odds') {
    result = computeOdds(wager, observedInput as ObservedInputOdds);
    observedValueForStore = (observedInput as ObservedInputOdds).observedValue;
  } else if (wager.kind === 'over-under') {
    result = computeOverUnder(wager, observedInput as ObservedInputOverUnder);
    observedValueForStore = (observedInput as ObservedInputOverUnder).observedValue;
  } else if (wager.kind === 'pointspread') {
    result = computePointspread(wager, observedInput as ObservedInputPointspread);
    const ps = observedInput as ObservedInputPointspread;
    // Stash both observed values in the extra payload; observedValue carries the diff for
    // backward compatibility with the existing schema.
    observedValueForStore = ps.observedValueA - ps.observedValueB;
    extra = { observedValueA: ps.observedValueA, observedValueB: ps.observedValueB } as Partial<Wager>;
  } else {
    throw new WagerResolutionError(`Unsupported wager kind "${(wager as any).kind}"`, 'unsupported_kind');
  }

  if (!result.winner) {
    throw new WagerResolutionError(
      `Cannot grade: ${result.warnings.join(' ') || 'no winner could be determined from observed values.'}`,
      'no_winner',
    );
  }

  const graded = await gradeWager(wagerId, observedValueForStore, result.winner, extra);
  if (!graded) {
    throw new WagerResolutionError('Wager could not be graded (status no longer eligible).', 'grade_failed');
  }

  await logAuditEvent({
    actor,
    eventType: 'wager_manually_graded',
    targetType: 'wager',
    targetId: wagerId,
    summary: `Wager ${wagerId} (${wager.kind}) graded → "${result.winner}" by ${actor}`,
    details: {
      wagerId, kind: wager.kind, fromStatus: wager.status, toStatus: 'graded',
      observedInput, winner: result.winner, confidence: result.confidence,
      observedValueStored: observedValueForStore, extra, note: note?.trim(),
    },
  });

  return graded;
}

// ── Manual void ──────────────────────────────────────────────────────────────

export async function manuallyVoidWager(wagerId: string, actor: string, reason: string): Promise<Wager> {
  if (!actor) throw new WagerResolutionError('actor is required', 'actor_required');
  if (!reason || !reason.trim()) throw new WagerResolutionError('reason is required', 'reason_required');

  const wager = await getWager(wagerId);
  if (!wager) throw new WagerResolutionError('Wager not found', 'wager_not_found');
  if (wager.status === 'void') throw new WagerResolutionError('Wager is already voided.', 'already_voided');
  if (wager.status === 'graded') {
    throw new WagerResolutionError('Wager is already graded — voiding a graded wager is not supported by the wager store.', 'already_graded');
  }

  const voided = await voidWager(wagerId, reason.trim());
  if (!voided) {
    throw new WagerResolutionError('Wager could not be voided (status no longer eligible).', 'void_failed');
  }

  await logAuditEvent({
    actor,
    eventType: 'wager_manually_voided',
    targetType: 'wager',
    targetId: wagerId,
    summary: `Wager ${wagerId} (${wager.kind}) voided by ${actor}: ${reason.trim()}`,
    details: { wagerId, fromStatus: wager.status, toStatus: 'void', reason: reason.trim() },
  });

  return voided;
}

// ── History ──────────────────────────────────────────────────────────────────

const RESOLUTION_EVENT_TYPES = new Set([
  'wager_resolution_preview_generated',
  'wager_manually_graded',
  'wager_manually_voided',
]);

export async function getResolutionHistory(wagerId: string, limit = 100): Promise<ResolutionHistoryEntry[]> {
  if (!wagerId) throw new WagerResolutionError('wagerId is required', 'wager_required');
  // The audit log stores at most 500 events. Pull a wider window and filter
  // to this wager. Acceptable for low-volume admin use.
  const events = await listAuditEvents(500);
  const filtered = events.filter(e =>
    e.targetType === 'wager' && e.targetId === wagerId && RESOLUTION_EVENT_TYPES.has(e.eventType),
  ).slice(0, limit);
  return filtered.map((e: AuditEvent) => ({
    id: e.id, createdAt: e.createdAt, actor: e.actor,
    eventType: e.eventType, summary: e.summary, details: e.details,
  }));
}

/**
 * Pulls every grading-related audit event across all wagers — used by the
 * "Grading Ledger" tab. Capped to keep the list readable.
 */
export async function getRecentGradingActivity(limit = 100): Promise<ResolutionHistoryEntry[]> {
  const events = await listAuditEvents(500);
  return events
    .filter(e => RESOLUTION_EVENT_TYPES.has(e.eventType))
    .slice(0, limit)
    .map((e: AuditEvent) => ({
      id: e.id, createdAt: e.createdAt, actor: e.actor,
      eventType: e.eventType, summary: e.summary, details: e.details,
    }));
}
