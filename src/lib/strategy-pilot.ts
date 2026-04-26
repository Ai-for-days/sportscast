// ── Step 83: Strategy pilot control room ────────────────────────────────────
//
// Plan, monitor, and evaluate manual pilots for strategies that have reached
// paper_approved or pilot_ready in the Step 82 registry. Read-only relative
// to execution — no orders are placed, no candidates created. The pilot
// record stores intent and the limits the operator must respect manually.
//
// Mode rules:
//   live_pilot   requires strategy.status === 'pilot_ready'
//   demo         requires strategy.status ∈ {paper_approved, pilot_ready}
//   paper        requires strategy.status ∈ {paper_approved, pilot_ready}

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { getStrategy, type StrategyStatus } from './strategy-registry';
import { listPaperRecords, type PaperPortfolioRecord } from './paper-strategy-portfolio';

const KEY_PREFIX = 'pilot:';
const SET_KEY = 'pilots:all';
const MAX_PILOTS = 200;

// ── Types ───────────────────────────────────────────────────────────────────

export type PilotStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
export type PilotMode = 'paper' | 'demo' | 'live_pilot';

export const PILOT_STATUSES: PilotStatus[] = ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'];
export const PILOT_MODES: PilotMode[] = ['paper', 'demo', 'live_pilot'];

const ALLOWED_TRANSITIONS: Record<PilotStatus, PilotStatus[]> = {
  draft:     ['scheduled', 'cancelled'],
  scheduled: ['active', 'cancelled', 'draft'],
  active:    ['paused', 'completed'],
  paused:    ['active', 'cancelled', 'completed'],
  completed: [],
  cancelled: [],
};

const STATUSES_OK_FOR_MODE: Record<PilotMode, StrategyStatus[]> = {
  paper:      ['paper_approved', 'pilot_ready'],
  demo:       ['paper_approved', 'pilot_ready'],
  live_pilot: ['pilot_ready'],
};

export interface PilotPlan {
  id: string;
  createdAt: string;
  updatedAt: string;
  strategyId: string;
  strategyName: string;
  status: PilotStatus;
  mode: PilotMode;
  startDate?: string;
  endDate?: string;
  maxCapitalCents: number;
  maxDailyLossCents: number;
  maxOpenPositions: number;
  maxSingleTradeCents: number;
  allowedSources?: string[];
  allowedMetrics?: string[];
  notes?: string[];
  createdBy: string;
  approvedBy?: string;
  history?: PilotHistoryEntry[];
}

interface PilotHistoryEntry {
  at: string;
  actor: string;
  fromStatus: PilotStatus;
  toStatus: PilotStatus;
  reason?: string;
}

export class PilotError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

function newId(): string {
  return `pilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createPilot(input: {
  strategyId: string;
  mode: PilotMode;
  startDate?: string;
  endDate?: string;
  maxCapitalCents: number;
  maxDailyLossCents: number;
  maxOpenPositions: number;
  maxSingleTradeCents: number;
  allowedSources?: string[];
  allowedMetrics?: string[];
  notes?: string;
  createdBy: string;
}): Promise<PilotPlan> {
  if (!PILOT_MODES.includes(input.mode)) {
    throw new PilotError(`Invalid mode "${input.mode}"`, 'invalid_mode');
  }
  const strategy = await getStrategy(input.strategyId);
  if (!strategy) throw new PilotError('Strategy not found', 'strategy_not_found');

  // Mode-vs-status guard
  const allowedStatuses = STATUSES_OK_FOR_MODE[input.mode];
  if (!allowedStatuses.includes(strategy.status)) {
    throw new PilotError(
      `Mode "${input.mode}" requires strategy status in [${allowedStatuses.join(', ')}], current is "${strategy.status}"`,
      'mode_status_mismatch',
    );
  }

  if (input.maxCapitalCents <= 0) throw new PilotError('maxCapitalCents must be > 0', 'invalid_limit');
  if (input.maxOpenPositions <= 0) throw new PilotError('maxOpenPositions must be > 0', 'invalid_limit');
  if (input.maxSingleTradeCents <= 0) throw new PilotError('maxSingleTradeCents must be > 0', 'invalid_limit');
  if (input.maxSingleTradeCents > input.maxCapitalCents) throw new PilotError('maxSingleTradeCents cannot exceed maxCapitalCents', 'invalid_limit');
  if (input.maxDailyLossCents < 0) throw new PilotError('maxDailyLossCents must be >= 0', 'invalid_limit');

  const redis = getRedis();
  const now = new Date().toISOString();
  const id = newId();
  const record: PilotPlan = {
    id,
    createdAt: now,
    updatedAt: now,
    strategyId: input.strategyId,
    strategyName: strategy.name,
    status: 'draft',
    mode: input.mode,
    startDate: input.startDate,
    endDate: input.endDate,
    maxCapitalCents: input.maxCapitalCents,
    maxDailyLossCents: input.maxDailyLossCents,
    maxOpenPositions: input.maxOpenPositions,
    maxSingleTradeCents: input.maxSingleTradeCents,
    allowedSources: input.allowedSources,
    allowedMetrics: input.allowedMetrics,
    notes: input.notes ? [`[${now}] ${input.createdBy}: ${input.notes}`] : [],
    createdBy: input.createdBy,
    history: [{ at: now, actor: input.createdBy, fromStatus: 'draft', toStatus: 'draft', reason: 'created' }],
  };

  await redis.set(`${KEY_PREFIX}${id}`, JSON.stringify(record));
  await redis.zadd(SET_KEY, { score: Date.now(), member: id });
  await trimToCap(redis, SET_KEY, KEY_PREFIX, MAX_PILOTS);

  await logAuditEvent({
    actor: input.createdBy,
    eventType: 'pilot_created',
    targetType: 'pilot',
    targetId: id,
    summary: `Pilot created for "${strategy.name}" (mode=${input.mode}, capital=$${input.maxCapitalCents / 100})`,
    details: { strategyId: input.strategyId, mode: input.mode },
  });

  return record;
}

export async function getPilot(id: string): Promise<PilotPlan | null> {
  const redis = getRedis();
  const raw = await redis.get(`${KEY_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as PilotPlan);
}

export async function savePilot(record: PilotPlan): Promise<void> {
  const redis = getRedis();
  await redis.set(`${KEY_PREFIX}${record.id}`, JSON.stringify(record));
}

export async function listPilots(limit = 200): Promise<PilotPlan[]> {
  const redis = getRedis();
  const total = await redis.zcard(SET_KEY);
  if (total === 0) return [];
  const ids = await redis.zrange(SET_KEY, 0, Math.min(total, limit) - 1, { rev: true });
  const out: PilotPlan[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${KEY_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function updatePilot(id: string, patch: Partial<Pick<PilotPlan, 'startDate' | 'endDate' | 'maxCapitalCents' | 'maxDailyLossCents' | 'maxOpenPositions' | 'maxSingleTradeCents' | 'allowedSources' | 'allowedMetrics'>>, actor: string): Promise<PilotPlan | null> {
  const existing = await getPilot(id);
  if (!existing) return null;
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw new PilotError(`Cannot edit a ${existing.status} pilot`, 'illegal_edit');
  }
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await savePilot(updated);
  await logAuditEvent({
    actor, eventType: 'pilot_updated',
    targetType: 'pilot', targetId: id,
    summary: `Pilot ${id} metadata updated`,
    details: { patchKeys: Object.keys(patch) },
  });
  return updated;
}

export async function transitionPilot(input: { id: string; toStatus: PilotStatus; actor: string; reason?: string }): Promise<PilotPlan> {
  const existing = await getPilot(input.id);
  if (!existing) throw new PilotError('Pilot not found', 'not_found');
  const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(input.toStatus)) {
    throw new PilotError(`Cannot transition pilot from ${existing.status} to ${input.toStatus}`, 'illegal_transition');
  }
  // For activation, re-verify the strategy status is still appropriate for the chosen mode.
  if (input.toStatus === 'active' || input.toStatus === 'scheduled') {
    const strategy = await getStrategy(existing.strategyId);
    if (!strategy) throw new PilotError('Strategy no longer exists', 'strategy_not_found');
    const allowedStatuses = STATUSES_OK_FOR_MODE[existing.mode];
    if (!allowedStatuses.includes(strategy.status)) {
      throw new PilotError(`Strategy is now in status "${strategy.status}" — not allowed for pilot mode "${existing.mode}"`, 'mode_status_mismatch');
    }
  }
  const now = new Date().toISOString();
  const entry: PilotHistoryEntry = { at: now, actor: input.actor, fromStatus: existing.status, toStatus: input.toStatus, reason: input.reason };
  const history = [...(existing.history ?? []), entry].slice(-50);
  const updated: PilotPlan = { ...existing, status: input.toStatus, updatedAt: now, history };
  await savePilot(updated);
  await logAuditEvent({
    actor: input.actor,
    eventType: 'pilot_transitioned',
    targetType: 'pilot',
    targetId: input.id,
    summary: `Pilot ${existing.strategyName}: ${existing.status} → ${input.toStatus}${input.reason ? ` (${input.reason})` : ''}`,
    details: { fromStatus: existing.status, toStatus: input.toStatus, mode: existing.mode },
  });
  return updated;
}

export async function addNote(id: string, note: string, actor: string): Promise<PilotPlan | null> {
  const existing = await getPilot(id);
  if (!existing) return null;
  const stamped = `[${new Date().toISOString()}] ${actor}: ${note}`;
  const notes = [...(existing.notes ?? []), stamped].slice(-100);
  const updated = { ...existing, notes, updatedAt: new Date().toISOString() };
  await savePilot(updated);
  return updated;
}

// ── Monitoring ──────────────────────────────────────────────────────────────
//
// v1: pilot metrics derive from the paper portfolio (Step 80) filtered to
// records that match the pilot's strategy filters and date window. Demo /
// live execution does not currently tag orders with a pilot id; until that
// linkage exists, this is a directional view, not a definitive trade ledger.

export interface PilotMonitoring {
  pilotId: string;
  pilotStatus: PilotStatus;
  pilotMode: PilotMode;
  matchingPaperRecords: number;
  openPositions: number;
  settledPositions: number;
  totalExposureCents: number;
  dailyPnlCents: number;
  totalPnlCents: number;
  totalStakeCents: number;
  roiPct: number | null;
  maxDrawdownCents: number;
  currentDrawdownCents: number;
  winRatePct: number | null;
  cumulative: { idx: number; pnlCents: number; cumulativePnlCents: number }[];
  dailyPnl: { date: string; pnlCents: number }[];
  limits: {
    maxCapitalCents: number;
    maxDailyLossCents: number;
    maxOpenPositions: number;
    maxSingleTradeCents: number;
  };
  utilization: {
    capitalPct: number;
    dailyLossPct: number;
    openPositionsPct: number;
    largestSingleTradePct: number;
  };
  breaches: string[];
  warningStatus: 'healthy' | 'watch' | 'breach';
  // Step 84: linked vs inferred attribution split
  linked: {
    candidates: number;
    demoOrders: number;
    liveOrders: number;
    paperRecords: number;
    settlements: number;
    settledPnlCents: number;
  };
  linkedVsInferred: {
    hasLinkedRecords: boolean;
    monitoringMode: 'linked' | 'inferred';
    notice: string;
  };
}

function withinPilotWindow(rec: PaperPortfolioRecord, pilot: PilotPlan): boolean {
  const t = new Date(rec.createdAt).getTime();
  if (pilot.startDate) {
    const start = new Date(pilot.startDate).getTime();
    if (Number.isFinite(start) && t < start) return false;
  }
  if (pilot.endDate) {
    const end = new Date(pilot.endDate).getTime() + 24 * 3600 * 1000;
    if (Number.isFinite(end) && t > end) return false;
  }
  return true;
}

function matchesAllowed(rec: PaperPortfolioRecord, pilot: PilotPlan): boolean {
  if (pilot.allowedSources && pilot.allowedSources.length > 0) {
    if (!pilot.allowedSources.includes(rec.source)) return false;
  }
  if (pilot.allowedMetrics && pilot.allowedMetrics.length > 0) {
    if (!rec.metric || !pilot.allowedMetrics.includes(rec.metric)) return false;
  }
  return true;
}

export async function computePilotMonitoring(pilot: PilotPlan): Promise<PilotMonitoring> {
  const [allPaper, linked] = await Promise.all([
    listPaperRecords(2000),
    loadLinkedRecords(pilot.id),
  ]);

  // Step 84: when authoritative pilot-linked records exist, prefer those for
  // monitoring. Otherwise fall back to the directional paper-portfolio filter.
  const linkedSettledPnl = linked.settlements.reduce((s: number, x: any) => s + (x.netPnlCents ?? 0), 0);
  const hasLinkedRecords = (
    linked.candidates.length + linked.demoOrders.length + linked.liveOrders.length + linked.paperRecords.length
  ) > 0;
  const monitoringMode: 'linked' | 'inferred' = hasLinkedRecords ? 'linked' : 'inferred';
  const linkedNotice = hasLinkedRecords
    ? `Monitoring uses ${linked.paperRecords.length + linked.demoOrders.length + linked.liveOrders.length} pilot-linked records as the authoritative source. Settlements: ${linked.settlements.length}.`
    : 'No pilot-linked records yet — showing directional metrics inferred from paper portfolio filtered by the pilot\'s window/sources/metrics. Use Execution Review to link records.';

  // For Step 84 v1, monitoring metrics still derive from the paper portfolio
  // (paper records carry pnl + status that match Kalshi outcomes 1:1). When
  // linked paper records exist, use them; otherwise fall back to the inferred
  // window/source/metric filter.
  const matching = hasLinkedRecords && linked.paperRecords.length > 0
    ? linked.paperRecords
    : allPaper.filter(r => withinPilotWindow(r, pilot) && matchesAllowed(r, pilot));

  const open = matching.filter(r => r.status === 'open');
  const settled = matching.filter(r => r.status === 'settled' && r.pnlCents != null);

  const totalExposureCents = open.reduce((s, r) => s + r.cappedStakeCents, 0);
  const totalStakeCents = settled.reduce((s, r) => s + r.cappedStakeCents, 0);
  const totalPnl = settled.reduce((s, r) => s + (r.pnlCents as number), 0);
  const wins = settled.filter(r => (r.pnlCents as number) > 0).length;

  // Daily P&L: group settled by yyyy-mm-dd of settledAt
  const byDay = new Map<string, number>();
  for (const r of settled) {
    const day = (r.settledAt ?? r.createdAt).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + (r.pnlCents as number));
  }
  const today = new Date().toISOString().slice(0, 10);
  const dailyPnlCents = byDay.get(today) ?? 0;

  // Cumulative P&L + drawdown
  const chrono = [...settled].sort((a, b) =>
    new Date(a.settledAt ?? a.createdAt).getTime() - new Date(b.settledAt ?? b.createdAt).getTime(),
  );
  let cum = 0; let runMax = 0; let maxDD = 0;
  const cumulative = chrono.map((r, i) => {
    cum += r.pnlCents as number;
    if (cum > runMax) runMax = cum;
    const dd = runMax - cum;
    if (dd > maxDD) maxDD = dd;
    return { idx: i + 1, pnlCents: r.pnlCents as number, cumulativePnlCents: cum };
  });
  const currentDrawdown = runMax - cum;

  // Limits
  const largestSingle = open.reduce((m, r) => Math.max(m, r.cappedStakeCents), 0);
  const utilization = {
    capitalPct: pilot.maxCapitalCents > 0 ? Math.round((totalExposureCents / pilot.maxCapitalCents) * 1000) / 10 : 0,
    dailyLossPct: pilot.maxDailyLossCents > 0 ? Math.round((Math.max(0, -dailyPnlCents) / pilot.maxDailyLossCents) * 1000) / 10 : 0,
    openPositionsPct: pilot.maxOpenPositions > 0 ? Math.round((open.length / pilot.maxOpenPositions) * 1000) / 10 : 0,
    largestSingleTradePct: pilot.maxSingleTradeCents > 0 ? Math.round((largestSingle / pilot.maxSingleTradeCents) * 1000) / 10 : 0,
  };

  const breaches: string[] = [];
  if (totalExposureCents > pilot.maxCapitalCents) breaches.push(`Total exposure $${(totalExposureCents / 100).toFixed(2)} exceeds capital cap $${(pilot.maxCapitalCents / 100).toFixed(2)}`);
  if (-dailyPnlCents > pilot.maxDailyLossCents) breaches.push(`Today's loss $${(-dailyPnlCents / 100).toFixed(2)} exceeds daily-loss cap $${(pilot.maxDailyLossCents / 100).toFixed(2)}`);
  if (open.length > pilot.maxOpenPositions) breaches.push(`${open.length} open positions exceeds ceiling ${pilot.maxOpenPositions}`);
  if (largestSingle > pilot.maxSingleTradeCents) breaches.push(`Largest single trade $${(largestSingle / 100).toFixed(2)} exceeds per-trade cap $${(pilot.maxSingleTradeCents / 100).toFixed(2)}`);

  let warningStatus: PilotMonitoring['warningStatus'] = 'healthy';
  if (breaches.length > 0) warningStatus = 'breach';
  else if (
    utilization.capitalPct > 80
    || utilization.dailyLossPct > 75
    || utilization.openPositionsPct > 80
    || utilization.largestSingleTradePct > 80
  ) warningStatus = 'watch';

  return {
    pilotId: pilot.id,
    pilotStatus: pilot.status,
    pilotMode: pilot.mode,
    matchingPaperRecords: matching.length,
    openPositions: open.length,
    settledPositions: settled.length,
    totalExposureCents,
    dailyPnlCents,
    totalPnlCents: totalPnl,
    totalStakeCents,
    roiPct: totalStakeCents > 0 ? Math.round((totalPnl / totalStakeCents) * 1000) / 10 : null,
    maxDrawdownCents: Math.round(maxDD),
    currentDrawdownCents: Math.round(currentDrawdown),
    winRatePct: settled.length > 0 ? Math.round((wins / settled.length) * 1000) / 10 : null,
    cumulative,
    dailyPnl: Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, pnlCents]) => ({ date, pnlCents })),
    limits: {
      maxCapitalCents: pilot.maxCapitalCents,
      maxDailyLossCents: pilot.maxDailyLossCents,
      maxOpenPositions: pilot.maxOpenPositions,
      maxSingleTradeCents: pilot.maxSingleTradeCents,
    },
    utilization,
    breaches,
    warningStatus,
    linked: {
      candidates: linked.candidates.length,
      demoOrders: linked.demoOrders.length,
      liveOrders: linked.liveOrders.length,
      paperRecords: linked.paperRecords.length,
      settlements: linked.settlements.length,
      settledPnlCents: linkedSettledPnl,
    },
    linkedVsInferred: {
      hasLinkedRecords,
      monitoringMode,
      notice: linkedNotice,
    },
  };
}

// ── Step 84: Pilot association validation + linking ─────────────────────────

export type ExecutionRecordType = 'candidate' | 'demo_order' | 'live_order' | 'paper_record';

export interface PilotAssociationCheck {
  ok: boolean;
  level: 'ok' | 'warn' | 'block';
  reason?: string;
}

/**
 * Validate that a record of the given type may be tagged with the given pilot.
 *
 * Rules:
 *   live_order  ↔ pilot.mode === 'live_pilot'   (block on mismatch)
 *   demo_order  ↔ pilot.mode === 'demo'         (block on mismatch — paper pilots are advisory only)
 *   candidate   ↔ any pilot mode                (warn on completed/cancelled)
 *   paper_record ↔ any pilot mode               (warn on completed/cancelled)
 *
 * Pilot must be in {draft, scheduled, active, paused} for new links.
 * Completed/cancelled pilots block new links (existing links are preserved).
 */
export function validatePilotAssociation(pilot: PilotPlan, recordType: ExecutionRecordType): PilotAssociationCheck {
  if (pilot.status === 'completed' || pilot.status === 'cancelled') {
    return { ok: false, level: 'block', reason: `Pilot is ${pilot.status} — cannot accept new record links` };
  }
  if (recordType === 'live_order' && pilot.mode !== 'live_pilot') {
    return { ok: false, level: 'block', reason: `Live orders can only link to pilot.mode === 'live_pilot' (this pilot is "${pilot.mode}")` };
  }
  if (recordType === 'demo_order' && pilot.mode === 'live_pilot') {
    return { ok: false, level: 'block', reason: `Demo orders cannot link to a live_pilot — that would obscure pilot attribution` };
  }
  if (recordType === 'demo_order' && pilot.mode === 'paper') {
    return { ok: true, level: 'warn', reason: `Linking a demo order to a paper pilot is informational only — pilot mode is "paper"` };
  }
  if (pilot.status === 'draft') {
    return { ok: true, level: 'warn', reason: 'Pilot is still in draft — link will be retained but pilot is not yet active' };
  }
  if (pilot.status === 'paused') {
    return { ok: true, level: 'warn', reason: 'Pilot is paused — links are accepted but should be reviewed before resuming' };
  }
  return { ok: true, level: 'ok' };
}

/** Apply a pilot tag to an arbitrary execution record key. Returns the updated record (or null). */
async function applyPilotTagToRecord(
  redis: any,
  recordKey: string,
  patch: { pilotId?: string; pilotName?: string; strategyId?: string; strategyName?: string },
): Promise<any | null> {
  const raw = await redis.get(recordKey);
  if (!raw) return null;
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const updated = { ...obj, ...patch, updatedAt: new Date().toISOString() };
  await redis.set(recordKey, JSON.stringify(updated));
  return updated;
}

/**
 * Link an execution record to a pilot. The caller has already validated via
 * validatePilotAssociation; this function just writes the tag and audit-logs.
 */
export async function linkRecordToPilot(input: {
  pilotId: string;
  recordType: ExecutionRecordType;
  recordId: string;
  actor: string;
}): Promise<{ ok: boolean; record?: any; check: PilotAssociationCheck; error?: string }> {
  const pilot = await getPilot(input.pilotId);
  if (!pilot) return { ok: false, check: { ok: false, level: 'block', reason: 'Pilot not found' }, error: 'pilot_not_found' };
  const check = validatePilotAssociation(pilot, input.recordType);
  if (check.level === 'block') {
    await logAuditEvent({
      actor: input.actor,
      eventType: 'pilot_execution_mode_mismatch_blocked',
      targetType: 'pilot',
      targetId: pilot.id,
      summary: `Refused to link ${input.recordType} ${input.recordId} to pilot ${pilot.id}: ${check.reason}`,
      details: { recordType: input.recordType, recordId: input.recordId, reason: check.reason },
    });
    return { ok: false, check, error: 'mode_status_block' };
  }

  const redis = getRedis();
  const key = recordKeyFor(input.recordType, input.recordId);
  if (!key) return { ok: false, check, error: 'unknown_record_type' };
  const patch = {
    pilotId: pilot.id,
    pilotName: pilot.strategyName,
    strategyId: pilot.strategyId,
    strategyName: pilot.strategyName,
  };
  const updated = await applyPilotTagToRecord(redis, key, patch);
  if (!updated) return { ok: false, check, error: 'record_not_found' };

  await logAuditEvent({
    actor: input.actor,
    eventType: check.level === 'warn' ? 'pilot_execution_association_warning' : 'pilot_record_linked',
    targetType: 'pilot',
    targetId: pilot.id,
    summary: `${check.level === 'warn' ? 'Warned ' : ''}Linked ${input.recordType} ${input.recordId} to pilot "${pilot.strategyName}" (${pilot.id})${check.reason ? ` — ${check.reason}` : ''}`,
    details: { recordType: input.recordType, recordId: input.recordId, mode: pilot.mode, status: pilot.status, warningReason: check.reason },
  });
  return { ok: true, record: updated, check };
}

export async function unlinkRecordFromPilot(input: {
  recordType: ExecutionRecordType;
  recordId: string;
  actor: string;
}): Promise<{ ok: boolean; record?: any; error?: string }> {
  const redis = getRedis();
  const key = recordKeyFor(input.recordType, input.recordId);
  if (!key) return { ok: false, error: 'unknown_record_type' };
  const raw = await redis.get(key);
  if (!raw) return { ok: false, error: 'record_not_found' };
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const previousPilotId = obj.pilotId;
  const updated = { ...obj, updatedAt: new Date().toISOString() };
  delete updated.pilotId;
  delete updated.pilotName;
  delete updated.strategyId;
  delete updated.strategyName;
  await redis.set(key, JSON.stringify(updated));

  await logAuditEvent({
    actor: input.actor,
    eventType: 'pilot_record_unlinked',
    targetType: 'pilot',
    targetId: previousPilotId ?? 'unknown',
    summary: `Unlinked ${input.recordType} ${input.recordId} from pilot ${previousPilotId ?? 'unknown'}`,
    details: { recordType: input.recordType, recordId: input.recordId, previousPilotId },
  });
  return { ok: true, record: updated };
}

function recordKeyFor(recordType: ExecutionRecordType, id: string): string | null {
  switch (recordType) {
    case 'candidate':    return `exec:candidate:${id}`;
    case 'demo_order':   return `kalshi:demo:order:${id}`;
    case 'live_order':   return `kalshi:live:order:${id}`;
    case 'paper_record': return `paper-portfolio:${id}`;
    default:             return null;
  }
}

// ── Step 84: Linked-record loaders for monitoring ───────────────────────────

export interface LinkedExecutionData {
  candidates: any[];
  demoOrders: any[];
  liveOrders: any[];
  paperRecords: any[];
  settlements: any[];
}

export async function loadLinkedRecords(pilotId: string): Promise<LinkedExecutionData> {
  const redis = getRedis();

  // Candidates
  const candCount = await redis.zcard('exec:candidates:all');
  const candidates: any[] = [];
  if (candCount > 0) {
    const ids = await redis.zrange('exec:candidates:all', 0, Math.min(candCount, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`exec:candidate:${id}`);
      if (!raw) continue;
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (c.pilotId === pilotId) candidates.push(c);
    }
  }

  // Demo + live orders
  const demoOrders: any[] = [];
  const liveOrders: any[] = [];
  for (const set of [{ key: 'kalshi:demo:orders', prefix: 'kalshi:demo:order:', sink: demoOrders }, { key: 'kalshi:live:orders', prefix: 'kalshi:live:order:', sink: liveOrders }]) {
    const cnt = await redis.zcard(set.key);
    if (cnt === 0) continue;
    const ids = await redis.zrange(set.key, 0, Math.min(cnt, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`${set.prefix}${id}`);
      if (!raw) continue;
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o.pilotId === pilotId) set.sink.push(o);
    }
  }

  // Paper records
  const paperRecords: any[] = [];
  const ppCount = await redis.zcard('paper-portfolio:all');
  if (ppCount > 0) {
    const ids = await redis.zrange('paper-portfolio:all', 0, Math.min(ppCount, 1000) - 1, { rev: true });
    for (const id of ids) {
      const raw = await redis.get(`paper-portfolio:${id}`);
      if (!raw) continue;
      const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (p.pilotId === pilotId) paperRecords.push(p);
    }
  }

  // Settlements (look up by orderId for any linked order)
  const settlements: any[] = [];
  const linkedOrderIds = new Set([...demoOrders, ...liveOrders].map(o => o.id));
  if (linkedOrderIds.size > 0) {
    const sCount = await redis.zcard('settlements:all');
    if (sCount > 0) {
      const sIds = await redis.zrange('settlements:all', 0, Math.min(sCount, 1000) - 1, { rev: true });
      for (const id of sIds) {
        const raw = await redis.get(`settlement:${id}`);
        if (!raw) continue;
        const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (s.orderId && linkedOrderIds.has(s.orderId)) settlements.push(s);
      }
    }
  }

  return { candidates, demoOrders, liveOrders, paperRecords, settlements };
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
