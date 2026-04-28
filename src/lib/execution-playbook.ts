// ── Step 90: Manual execution playbook + operator checklist ─────────────────
//
// A structured manual checklist that walks an operator from a signal through
// signal review → risk review → pilot linking → approval → execution →
// post-trade. The lib persists checklist runs and per-item progress; it
// never submits orders, never creates execution candidates, never auto-links
// pilots, never bypasses approvals. Pure workflow guidance.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ───────────────────────────────────────────────────────────────────

export type ItemCategory =
  | 'signal_review'
  | 'risk_review'
  | 'pilot_linking'
  | 'approval'
  | 'execution'
  | 'post_trade';

export type ItemStatus = 'pending' | 'completed' | 'blocked' | 'skipped';
export type RunStatus = 'open' | 'completed' | 'cancelled';
export type RunMode = 'paper' | 'demo' | 'live';

export const ITEM_CATEGORIES: ItemCategory[] = [
  'signal_review', 'risk_review', 'pilot_linking', 'approval', 'execution', 'post_trade',
];
export const ITEM_STATUSES: ItemStatus[] = ['pending', 'completed', 'blocked', 'skipped'];
export const RUN_STATUSES: RunStatus[] = ['open', 'completed', 'cancelled'];
export const RUN_MODES: RunMode[] = ['paper', 'demo', 'live'];

export interface PlaybookItem {
  id: string;
  title: string;
  category: ItemCategory;
  required: boolean;
  status: ItemStatus;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

export interface PlaybookRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  signalId: string;
  strategyId?: string;
  pilotId?: string;
  candidateId?: string;
  orderId?: string;
  mode: RunMode;
  status: RunStatus;
  checklist: PlaybookItem[];
  operatorId: string;
  notes: string[];           // append-only timestamped notes
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export class PlaybookError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ─────────────────────────────────────────────────────

const RUN_PREFIX = 'playbook:';
const RUN_SET = 'playbooks:all';
const MAX_RUNS = 1000;

// ── ID helpers ──────────────────────────────────────────────────────────────

function newRunId(): string {
  return `pbk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newItemId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Default checklist ───────────────────────────────────────────────────────

interface DefaultItemSpec {
  title: string;
  category: ItemCategory;
  required: boolean;
}

const DEFAULT_ITEMS: DefaultItemSpec[] = [
  // Signal review
  { title: 'Verify calibrated edge is positive and consistent with signal label', category: 'signal_review', required: true },
  { title: 'Verify reliability factor (calibration / segment evidence)',           category: 'signal_review', required: true },
  { title: 'Verify systematic eligibility flag is true',                            category: 'signal_review', required: true },
  { title: 'Verify sample size / evidence label is acceptable',                     category: 'signal_review', required: true },
  { title: 'Verify no indoor/venue warning that would invalidate the signal',       category: 'signal_review', required: true },

  // Risk review
  { title: 'Review allocation recommendation (capped vs uncapped stake)',           category: 'risk_review',   required: true },
  { title: 'Review allocation stress test verdict',                                 category: 'risk_review',   required: true },
  { title: 'Review concentration exposure (city / date / metric)',                  category: 'risk_review',   required: true },
  { title: 'Verify pilot limits will not be breached by this trade',                category: 'risk_review',   required: true },

  // Pilot linking
  { title: 'Select pilot if applicable (or confirm no pilot needed)',               category: 'pilot_linking', required: true },
  { title: 'Verify pilot mode matches execution mode (paper / demo / live)',        category: 'pilot_linking', required: true },
  { title: 'Verify pilot status is active or scheduled',                            category: 'pilot_linking', required: false },

  // Approval
  { title: 'Verify required approvals (RBAC, dual-control if live)',                category: 'approval',      required: true },
  { title: 'Verify strategy status is consistent with the chosen mode',             category: 'approval',      required: true },
  { title: 'Verify live readiness (only required if mode === live)',                category: 'approval',      required: false },

  // Execution
  { title: 'Create execution candidate manually (no automation)',                   category: 'execution',     required: true },
  { title: 'Review dry-run order (size, price, side, market)',                      category: 'execution',     required: true },
  { title: 'Submit demo / live order manually if approved',                         category: 'execution',     required: false },

  // Post-trade
  { title: 'Link order to pilot (if applicable)',                                   category: 'post_trade',    required: false },
  { title: 'Journal the decision in the desk decisions log',                        category: 'post_trade',    required: true },
  { title: 'Refresh reconciliation / position view',                                category: 'post_trade',    required: false },
  { title: 'Add review note (rationale, observations, follow-ups)',                 category: 'post_trade',    required: true },
];

export function defaultChecklist(): PlaybookItem[] {
  // Generate fresh items so each run has independently mutable item ids
  return DEFAULT_ITEMS.map((spec, i) => ({
    id: newItemId(`itm-${i}`),
    title: spec.title,
    category: spec.category,
    required: spec.required,
    status: 'pending',
  }));
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function startPlaybook(input: {
  signalId: string;
  mode: RunMode;
  operatorId: string;
  strategyId?: string;
  pilotId?: string;
  note?: string;
}): Promise<PlaybookRun> {
  if (!input.signalId || !input.signalId.trim()) throw new PlaybookError('signalId is required', 'signal_required');
  if (!RUN_MODES.includes(input.mode)) throw new PlaybookError(`Invalid mode "${input.mode}"`, 'invalid_mode');
  if (!input.operatorId) throw new PlaybookError('operatorId is required', 'operator_required');

  const id = newRunId();
  const now = new Date().toISOString();
  const run: PlaybookRun = {
    id,
    createdAt: now,
    updatedAt: now,
    signalId: input.signalId.trim(),
    strategyId: input.strategyId?.trim() || undefined,
    pilotId: input.pilotId?.trim() || undefined,
    mode: input.mode,
    status: 'open',
    checklist: defaultChecklist(),
    operatorId: input.operatorId,
    notes: input.note ? [`[${now}] ${input.operatorId}: ${input.note.trim()}`] : [],
  };

  const redis = getRedis();
  await redis.set(`${RUN_PREFIX}${id}`, JSON.stringify(run));
  await redis.zadd(RUN_SET, { score: Date.now(), member: id });
  await trimToCap(redis, RUN_SET, RUN_PREFIX, MAX_RUNS);

  await logAuditEvent({
    actor: input.operatorId,
    eventType: 'execution_playbook_started',
    targetType: 'playbook',
    targetId: id,
    summary: `Playbook ${id} started for signal ${input.signalId} (mode=${input.mode})`,
    details: { runId: id, signalId: input.signalId, mode: input.mode, pilotId: input.pilotId, strategyId: input.strategyId },
  });

  return run;
}

export async function getRun(id: string): Promise<PlaybookRun | null> {
  const redis = getRedis();
  const raw = await redis.get(`${RUN_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PlaybookRun);
}

export async function listRuns(limit = 200): Promise<PlaybookRun[]> {
  const redis = getRedis();
  const total = await redis.zcard(RUN_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(RUN_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: PlaybookRun[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${RUN_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

async function saveRun(run: PlaybookRun): Promise<void> {
  const redis = getRedis();
  await redis.set(`${RUN_PREFIX}${run.id}`, JSON.stringify(run));
}

// ── Item updates ────────────────────────────────────────────────────────────

export async function updateItem(input: {
  runId: string;
  itemId: string;
  status: ItemStatus;
  notes?: string;
  actor: string;
}): Promise<PlaybookRun> {
  if (!ITEM_STATUSES.includes(input.status)) throw new PlaybookError(`Invalid item status "${input.status}"`, 'invalid_item_status');
  const run = await getRun(input.runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  if (run.status !== 'open') throw new PlaybookError(`Cannot update items on a ${run.status} playbook`, 'illegal_update');

  const idx = run.checklist.findIndex(i => i.id === input.itemId);
  if (idx === -1) throw new PlaybookError('Item not found', 'item_not_found');
  const item = run.checklist[idx];

  // Skipping a required item demands a written rationale.
  if (item.required && input.status === 'skipped' && !input.notes?.trim()) {
    throw new PlaybookError('Skipping a required item requires a note explaining why', 'skip_note_required');
  }

  const now = new Date().toISOString();
  const updated: PlaybookItem = {
    ...item,
    status: input.status,
    completedBy: input.status === 'completed' ? input.actor : item.completedBy,
    completedAt: input.status === 'completed' ? now : item.completedAt,
    notes: input.notes?.trim() ? input.notes.trim() : item.notes,
  };
  run.checklist[idx] = updated;
  run.updatedAt = now;
  await saveRun(run);

  await logAuditEvent({
    actor: input.actor,
    eventType: 'execution_playbook_item_updated',
    targetType: 'playbook',
    targetId: run.id,
    summary: `Playbook ${run.id}: item "${item.title}" → ${input.status}`,
    details: { runId: run.id, itemId: input.itemId, fromStatus: item.status, toStatus: input.status, category: item.category, required: item.required },
  });

  return run;
}

// ── Linking (manual; no candidate/order creation) ───────────────────────────

export async function linkCandidate(runId: string, candidateId: string, actor: string): Promise<PlaybookRun> {
  if (!candidateId || !candidateId.trim()) throw new PlaybookError('candidateId is required', 'candidate_required');
  const run = await getRun(runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  if (run.status !== 'open') throw new PlaybookError(`Cannot link to a ${run.status} playbook`, 'illegal_link');
  run.candidateId = candidateId.trim();
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  await logAuditEvent({
    actor, eventType: 'execution_playbook_candidate_linked', targetType: 'playbook', targetId: runId,
    summary: `Playbook ${runId} linked to candidate ${candidateId}`,
    details: { runId, candidateId },
  });
  return run;
}

export async function linkOrder(runId: string, orderId: string, actor: string): Promise<PlaybookRun> {
  if (!orderId || !orderId.trim()) throw new PlaybookError('orderId is required', 'order_required');
  const run = await getRun(runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  if (run.status !== 'open') throw new PlaybookError(`Cannot link to a ${run.status} playbook`, 'illegal_link');
  run.orderId = orderId.trim();
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  await logAuditEvent({
    actor, eventType: 'execution_playbook_order_linked', targetType: 'playbook', targetId: runId,
    summary: `Playbook ${runId} linked to order ${orderId}`,
    details: { runId, orderId },
  });
  return run;
}

export async function linkPilot(runId: string, pilotId: string, actor: string): Promise<PlaybookRun> {
  if (!pilotId || !pilotId.trim()) throw new PlaybookError('pilotId is required', 'pilot_required');
  const run = await getRun(runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  if (run.status !== 'open') throw new PlaybookError(`Cannot link to a ${run.status} playbook`, 'illegal_link');
  run.pilotId = pilotId.trim();
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  await logAuditEvent({
    actor, eventType: 'execution_playbook_pilot_linked', targetType: 'playbook', targetId: runId,
    summary: `Playbook ${runId} linked to pilot ${pilotId}`,
    details: { runId, pilotId },
  });
  return run;
}

// ── Notes / transitions ─────────────────────────────────────────────────────

export async function addNote(runId: string, note: string, actor: string): Promise<PlaybookRun> {
  if (!note?.trim()) throw new PlaybookError('note is required', 'note_required');
  const run = await getRun(runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  const stamped = `[${new Date().toISOString()}] ${actor}: ${note.trim()}`;
  run.notes = [...(run.notes ?? []), stamped].slice(-200);
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  return run;
}

export async function completePlaybook(runId: string, actor: string): Promise<PlaybookRun> {
  const run = await getRun(runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  if (run.status !== 'open') throw new PlaybookError(`Cannot complete a ${run.status} playbook`, 'illegal_transition');

  // Required items must be completed (or skipped with a note).
  const incompleteRequired = run.checklist.filter(i =>
    i.required && i.status !== 'completed' && i.status !== 'skipped',
  );
  if (incompleteRequired.length > 0) {
    throw new PlaybookError(
      `Cannot complete — ${incompleteRequired.length} required item(s) still pending or blocked`,
      'required_items_incomplete',
    );
  }

  const now = new Date().toISOString();
  run.status = 'completed';
  run.completedAt = now;
  run.updatedAt = now;
  await saveRun(run);

  await logAuditEvent({
    actor, eventType: 'execution_playbook_completed', targetType: 'playbook', targetId: runId,
    summary: `Playbook ${runId} completed (signal=${run.signalId}, mode=${run.mode})`,
    details: { runId, signalId: run.signalId, mode: run.mode, candidateId: run.candidateId, orderId: run.orderId, pilotId: run.pilotId },
  });

  return run;
}

export async function cancelPlaybook(runId: string, actor: string, reason: string): Promise<PlaybookRun> {
  if (!reason?.trim()) throw new PlaybookError('cancel reason is required', 'reason_required');
  const run = await getRun(runId);
  if (!run) throw new PlaybookError('Playbook not found', 'run_not_found');
  if (run.status !== 'open') throw new PlaybookError(`Cannot cancel a ${run.status} playbook`, 'illegal_transition');

  const now = new Date().toISOString();
  run.status = 'cancelled';
  run.cancelledAt = now;
  run.cancelReason = reason.trim();
  run.updatedAt = now;
  run.notes = [...(run.notes ?? []), `[${now}] ${actor}: cancelled — ${reason.trim()}`];
  await saveRun(run);

  await logAuditEvent({
    actor, eventType: 'execution_playbook_cancelled', targetType: 'playbook', targetId: runId,
    summary: `Playbook ${runId} cancelled: ${reason.trim()}`,
    details: { runId, reason: reason.trim() },
  });

  return run;
}

// ── Aggregations ────────────────────────────────────────────────────────────

export interface PlaybookSummary {
  total: number;
  byStatus: Record<RunStatus, number>;
  byMode: Record<RunMode, number>;
  averageProgressPct: number | null;
  longestOpenAgeMs: number;
}

export function progressOf(run: PlaybookRun): { completed: number; total: number; pct: number } {
  const total = run.checklist.length;
  const completed = run.checklist.filter(i => i.status === 'completed').length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, total, pct };
}

export function blockersOf(run: PlaybookRun): PlaybookItem[] {
  return run.checklist.filter(i => i.status === 'blocked');
}

export function pendingRequiredOf(run: PlaybookRun): PlaybookItem[] {
  return run.checklist.filter(i => i.required && i.status === 'pending');
}

export function summarizeRuns(runs: PlaybookRun[]): PlaybookSummary {
  const byStatus: Record<RunStatus, number> = { open: 0, completed: 0, cancelled: 0 };
  const byMode: Record<RunMode, number> = { paper: 0, demo: 0, live: 0 };
  let progSum = 0;
  let progCount = 0;
  let longestOpen = 0;
  const now = Date.now();
  for (const r of runs) {
    byStatus[r.status]++;
    byMode[r.mode]++;
    const p = progressOf(r);
    if (p.total > 0) { progSum += p.pct; progCount++; }
    if (r.status === 'open') {
      const age = now - new Date(r.createdAt).getTime();
      if (age > longestOpen) longestOpen = age;
    }
  }
  return {
    total: runs.length,
    byStatus,
    byMode,
    averageProgressPct: progCount > 0 ? Math.round(progSum / progCount) : null,
    longestOpenAgeMs: longestOpen,
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
