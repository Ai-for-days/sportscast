// ── Step 102: Daily Operator Runbook ────────────────────────────────────────
//
// One runbook per UTC day. Recordkeeping only: never creates wagers, never
// grades or voids them, never settles balances, never mutates RBAC, never
// places trades. Writes are confined to daily-runbook:* and the audit log.

import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

// ── Types ────────────────────────────────────────────────────────────────────

export type RunbookStatus = 'open' | 'completed';
export type ItemStatus = 'pending' | 'done' | 'skipped';

export type SectionKey =
  | 'market_creation_review'
  | 'active_market_monitoring'
  | 'resolution_and_liability'
  | 'operator_governance'
  | 'safety_confirmation';

export const SECTION_LABELS: Record<SectionKey, string> = {
  market_creation_review: 'Market Creation Review',
  active_market_monitoring: 'Active Market Monitoring',
  resolution_and_liability: 'Resolution & Liability',
  operator_governance: 'Operator Governance',
  safety_confirmation: 'Safety Confirmation',
};

export const SECTION_ORDER: SectionKey[] = [
  'market_creation_review',
  'active_market_monitoring',
  'resolution_and_liability',
  'operator_governance',
  'safety_confirmation',
];

export interface ChecklistItem {
  id: string;
  section: SectionKey;
  label: string;
  /** Optional helper text shown under the label. */
  helper?: string;
  /** Optional link to the most relevant admin tool. */
  link?: string;
  status: ItemStatus;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface DailyRunbook {
  id: string;            // == date for simplicity
  date: string;          // YYYY-MM-DD (UTC)
  createdAt: string;
  createdBy: string;
  status: RunbookStatus;
  checklistItems: ChecklistItem[];
  completedAt?: string;
  completedBy?: string;
  notes: string[];       // append-only timestamped notes
}

export interface RunbookProgress {
  total: number;
  done: number;
  skipped: number;
  pending: number;
  percentComplete: number;
  canComplete: boolean;
}

export class RunbookError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

// ── Storage keys / caps ──────────────────────────────────────────────────────

const RUNBOOK_PREFIX = 'daily-runbook:';
const RUNBOOKS_SET = 'daily-runbooks:all';
const MAX_RUNBOOKS = 365;

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function newItemId(section: SectionKey, idx: number): string {
  return `${section}-${idx}`;
}

// ── Default checklist ────────────────────────────────────────────────────────

interface DefaultItemSpec {
  section: SectionKey;
  label: string;
  helper?: string;
  link?: string;
}

const DEFAULT_ITEMS: DefaultItemSpec[] = [
  // ── Market Creation Review ──
  { section: 'market_creation_review',
    label: 'Review pricing recommendations from yesterday',
    helper: 'Open the Pricing Engine inside the wager creation modal — confirm any low-margin recommendations are intentional.',
    link: '/admin/wagers' },
  { section: 'market_creation_review',
    label: 'Review market design warnings on new wagers',
    helper: 'Use Market Design Lab inside the wager creation modal — confirm fairness/fun/risk verdicts before publishing.',
    link: '/admin/wagers' },
  { section: 'market_creation_review',
    label: 'Confirm no market published with negative implied hold',
    helper: 'Cross-check pricing recommendations and market design verdicts. Negative hold pays out more than collected.',
    link: '/admin/wagers' },
  { section: 'market_creation_review',
    label: 'Confirm new markets are clearly understandable to players',
    helper: 'Title, description, location, line, and outcomes are unambiguous.',
    link: '/admin/wagers' },

  // ── Active Market Monitoring ──
  { section: 'active_market_monitoring',
    label: 'Review open wagers approaching lock time',
    helper: 'Operator dashboard or /admin/wagers — flag anything mispriced before it locks.',
    link: '/admin/wagers' },
  { section: 'active_market_monitoring',
    label: 'Review locked / past-lock wagers awaiting grading',
    helper: 'Wager Resolution surfaces locked + past-lock open wagers in one list.',
    link: '/admin/system/wager-resolution' },
  { section: 'active_market_monitoring',
    label: 'Run Market Integrity on high-exposure markets',
    helper: 'Pick the top markets by stake from Settlement Preview and analyze each one.',
    link: '/admin/system/market-integrity' },

  // ── Resolution & Liability ──
  { section: 'resolution_and_liability',
    label: 'Grade eligible locked wagers using observed weather data',
    helper: 'Wager Resolution: enter observed values, generate preview, then click Grade. Preview-then-grade is required.',
    link: '/admin/system/wager-resolution' },
  { section: 'resolution_and_liability',
    label: 'Void wagers only with a documented reason',
    helper: 'Voids require a written reason. Document ties / pushes / data issues in the reason field.',
    link: '/admin/system/wager-resolution' },
  { section: 'resolution_and_liability',
    label: 'Generate settlement previews for graded wagers',
    helper: 'Settlement Preview is read-only. It projects payouts but does not move money.',
    link: '/admin/system/wager-settlement-preview' },
  { section: 'resolution_and_liability',
    label: 'Review projected net house result and concentration',
    helper: 'Look for negative net house results or single-user concentration above 25%.',
    link: '/admin/system/wager-settlement-preview' },

  // ── Operator Governance ──
  { section: 'operator_governance',
    label: 'Review operator certifications expiring in the next 30 days',
    helper: 'Renew or revoke before lapse. Certification is advisory and does not grant RBAC roles.',
    link: '/admin/system/operator-certification' },
  { section: 'operator_governance',
    label: 'Review RBAC review warnings and unacknowledged reviews',
    helper: 'Acknowledge or escalate. RBAC review is advisory; actual RBAC changes happen at /admin/security.',
    link: '/admin/system/operator-rbac-review' },
  { section: 'operator_governance',
    label: 'Review unresolved advisory alerts on the Strategy Brief',
    helper: 'Acknowledge alerts you have seen; resolve alerts whose root cause has been fixed.',
    link: '/admin/system/strategy-brief' },

  // ── Safety Confirmation ──
  { section: 'safety_confirmation',
    label: 'Confirm no automatic settlement was triggered today',
    helper: 'There is no auto-settle path. Mark done after spot-checking the audit log for unexpected events.',
    link: '/admin/system/wager-settlement-preview' },
  { section: 'safety_confirmation',
    label: 'Confirm no automatic RBAC change was made today',
    helper: 'Only /admin/security mutates RBAC. Spot-check Security Activity for unexpected events.',
    link: '/admin/security' },
  { section: 'safety_confirmation',
    label: 'Confirm no automatic trading occurred',
    helper: 'WagerOnWeather has no autonomous trading path. Confirm no execution candidates / orders appeared without operator action.',
    link: '/admin/execution-candidates' },
  { section: 'safety_confirmation',
    label: 'Confirm every material action today was manually confirmed',
    helper: 'Grading, voiding, certification, and revocation should all map to operator clicks recorded in the audit log.',
    link: '/admin/system/command-center' },
];

export function defaultChecklist(): ChecklistItem[] {
  // Group by section so id ordering is stable per section
  const counts: Record<SectionKey, number> = {
    market_creation_review: 0, active_market_monitoring: 0,
    resolution_and_liability: 0, operator_governance: 0, safety_confirmation: 0,
  };
  return DEFAULT_ITEMS.map(spec => {
    counts[spec.section]++;
    return {
      id: newItemId(spec.section, counts[spec.section]),
      section: spec.section,
      label: spec.label,
      helper: spec.helper,
      link: spec.link,
      status: 'pending' as ItemStatus,
    };
  });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function saveRunbook(rb: DailyRunbook): Promise<void> {
  const redis = getRedis();
  await redis.set(`${RUNBOOK_PREFIX}${rb.id}`, JSON.stringify(rb));
}

export async function getRunbook(date: string): Promise<DailyRunbook | null> {
  if (!date) return null;
  const redis = getRedis();
  const raw = await redis.get(`${RUNBOOK_PREFIX}${date}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as DailyRunbook);
}

export async function listRunbooks(limit = 60): Promise<DailyRunbook[]> {
  const redis = getRedis();
  const total = await redis.zcard(RUNBOOKS_SET);
  if (total === 0) return [];
  const ids = await redis.zrange(RUNBOOKS_SET, 0, Math.min(total, limit) - 1, { rev: true });
  const out: DailyRunbook[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${RUNBOOK_PREFIX}${id}`);
    if (raw) out.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return out;
}

export async function createOrLoadToday(actor: string): Promise<DailyRunbook> {
  if (!actor) throw new RunbookError('actor is required', 'actor_required');
  const date = todayUtcDate();

  const existing = await getRunbook(date);
  if (existing) return existing;

  const now = new Date().toISOString();
  const rb: DailyRunbook = {
    id: date,
    date,
    createdAt: now,
    createdBy: actor,
    status: 'open',
    checklistItems: defaultChecklist(),
    notes: [],
  };

  const redis = getRedis();
  await saveRunbook(rb);
  await redis.zadd(RUNBOOKS_SET, { score: Date.now(), member: date });
  await trimToCap(redis);

  await logAuditEvent({
    actor,
    eventType: 'daily_runbook_created',
    targetType: 'daily_runbook',
    targetId: date,
    summary: `Daily runbook ${date} created by ${actor}`,
    details: { date, itemCount: rb.checklistItems.length },
  });

  return rb;
}

export async function updateItem(input: {
  date: string;
  itemId: string;
  status: ItemStatus;
  note?: string;
  actor: string;
}): Promise<DailyRunbook> {
  if (!input.actor) throw new RunbookError('actor is required', 'actor_required');
  if (!['pending', 'done', 'skipped'].includes(input.status)) {
    throw new RunbookError(`Invalid item status "${input.status}"`, 'invalid_status');
  }

  const rb = await getRunbook(input.date);
  if (!rb) throw new RunbookError('Runbook not found', 'runbook_not_found');
  if (rb.status === 'completed') throw new RunbookError('Runbook is completed — items are read-only', 'runbook_completed');

  const idx = rb.checklistItems.findIndex(i => i.id === input.itemId);
  if (idx === -1) throw new RunbookError('Item not found', 'item_not_found');
  const existing = rb.checklistItems[idx];

  // Skip requires a non-empty note
  if (input.status === 'skipped' && !input.note?.trim()) {
    throw new RunbookError('Skipping an item requires a note explaining why', 'skip_note_required');
  }

  const now = new Date().toISOString();
  const updated: ChecklistItem = {
    ...existing,
    status: input.status,
    note: input.note?.trim() ? input.note.trim() : existing.note,
    updatedAt: now,
    updatedBy: input.actor,
  };
  rb.checklistItems[idx] = updated;
  await saveRunbook(rb);

  await logAuditEvent({
    actor: input.actor,
    eventType: 'daily_runbook_item_updated',
    targetType: 'daily_runbook',
    targetId: rb.date,
    summary: `Runbook ${rb.date}: item "${existing.label}" → ${input.status}`,
    details: { date: rb.date, itemId: input.itemId, fromStatus: existing.status, toStatus: input.status, section: existing.section },
  });

  return rb;
}

export async function addNote(date: string, note: string, actor: string): Promise<DailyRunbook> {
  if (!actor) throw new RunbookError('actor is required', 'actor_required');
  if (!note?.trim()) throw new RunbookError('note is required', 'note_required');

  const rb = await getRunbook(date);
  if (!rb) throw new RunbookError('Runbook not found', 'runbook_not_found');

  const stamped = `[${new Date().toISOString()}] ${actor}: ${note.trim()}`;
  rb.notes = [...(rb.notes ?? []), stamped].slice(-200);
  await saveRunbook(rb);

  await logAuditEvent({
    actor,
    eventType: 'daily_runbook_note_added',
    targetType: 'daily_runbook',
    targetId: rb.date,
    summary: `Note added to runbook ${rb.date}`,
    details: { date: rb.date },
  });

  return rb;
}

export async function completeRunbook(date: string, actor: string): Promise<DailyRunbook> {
  if (!actor) throw new RunbookError('actor is required', 'actor_required');
  const rb = await getRunbook(date);
  if (!rb) throw new RunbookError('Runbook not found', 'runbook_not_found');
  if (rb.status === 'completed') throw new RunbookError('Runbook already completed', 'already_completed');

  const incomplete = rb.checklistItems.filter(i => i.status !== 'done' && i.status !== 'skipped');
  if (incomplete.length > 0) {
    throw new RunbookError(
      `Cannot complete runbook — ${incomplete.length} item(s) still pending. Mark each as done or skipped (with note).`,
      'items_incomplete',
    );
  }

  const now = new Date().toISOString();
  rb.status = 'completed';
  rb.completedAt = now;
  rb.completedBy = actor;
  await saveRunbook(rb);

  await logAuditEvent({
    actor,
    eventType: 'daily_runbook_completed',
    targetType: 'daily_runbook',
    targetId: rb.date,
    summary: `Daily runbook ${rb.date} completed by ${actor}`,
    details: {
      date: rb.date,
      doneCount: rb.checklistItems.filter(i => i.status === 'done').length,
      skippedCount: rb.checklistItems.filter(i => i.status === 'skipped').length,
    },
  });

  return rb;
}

// ── Aggregations ─────────────────────────────────────────────────────────────

export function progressOf(rb: DailyRunbook): RunbookProgress {
  const total = rb.checklistItems.length;
  const done = rb.checklistItems.filter(i => i.status === 'done').length;
  const skipped = rb.checklistItems.filter(i => i.status === 'skipped').length;
  const pending = total - done - skipped;
  const percentComplete = total === 0 ? 0 : Math.round(((done + skipped) / total) * 100);
  return { total, done, skipped, pending, percentComplete, canComplete: pending === 0 && total > 0 };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function trimToCap(redis: any) {
  const total = await redis.zcard(RUNBOOKS_SET);
  if (total <= MAX_RUNBOOKS) return;
  const overflow = total - MAX_RUNBOOKS;
  const oldest = await redis.zrange(RUNBOOKS_SET, 0, overflow - 1);
  if (oldest && oldest.length > 0) {
    await redis.zremrangebyrank(RUNBOOKS_SET, 0, overflow - 1);
    for (const oldId of oldest) await redis.del(`${RUNBOOK_PREFIX}${oldId}`);
  }
}
