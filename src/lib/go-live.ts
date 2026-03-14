import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface ChecklistItem {
  id: string;
  createdAt: string;
  itemKey: string;
  label: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
}

export interface LaunchSignoff {
  id: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  approvedBy?: string;
  rejectedBy?: string;
  notes?: string;
  checklistSnapshot?: any;
}

export type LaunchState = 'prelaunch' | 'ready' | 'locked_for_launch' | 'launched' | 'launch_blocked';

const CHECKLIST_KEY = 'golive:checklist';
const SIGNOFF_PREFIX = 'golive:signoff:';
const SIGNOFF_SET = 'golive:signoffs';
const STATE_KEY = 'golive:state';

/* ------------------------------------------------------------------ */
/*  Default checklist items                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_ITEMS: Array<{ itemKey: string; label: string }> = [
  { itemKey: 'demo_execution_tested', label: 'Demo execution tested' },
  { itemKey: 'resilience_drills_completed', label: 'Resilience drills completed' },
  { itemKey: 'critical_alerts_tested', label: 'Critical alerts routing tested' },
  { itemKey: 'signoff_process_tested', label: 'Signoff process tested' },
  { itemKey: 'reconciliation_tested', label: 'Reconciliation workflow tested' },
  { itemKey: 'settlement_tested', label: 'Settlement workflow tested' },
  { itemKey: 'roles_configured', label: 'Roles and approvals configured' },
  { itemKey: 'kill_switch_verified', label: 'Kill switch verified' },
  { itemKey: 'live_readiness_completed', label: 'Live readiness preflight completed' },
  { itemKey: 'change_control_active', label: 'Change control active' },
  { itemKey: 'compliance_exports_verified', label: 'Compliance exports verified' },
  { itemKey: 'history_snapshots_working', label: 'History snapshots working' },
  { itemKey: 'reporting_working', label: 'Reporting working' },
  { itemKey: 'operations_center_reviewed', label: 'Operations center reviewed' },
];

/* ------------------------------------------------------------------ */
/*  Checklist CRUD                                                      */
/* ------------------------------------------------------------------ */

export async function getChecklist(): Promise<ChecklistItem[]> {
  const redis = getRedis();
  const raw = await redis.get(CHECKLIST_KEY);
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw as ChecklistItem[];
}

async function saveChecklist(items: ChecklistItem[]): Promise<void> {
  const redis = getRedis();
  await redis.set(CHECKLIST_KEY, JSON.stringify(items));
}

export async function seedDefaultChecklist(): Promise<number> {
  const existing = await getChecklist();
  if (existing.length > 0) return 0;
  const now = new Date().toISOString();
  const items: ChecklistItem[] = DEFAULT_ITEMS.map((d, i) => ({
    id: `cli-${Date.now()}-${i}`,
    createdAt: now,
    itemKey: d.itemKey,
    label: d.label,
    completed: false,
  }));
  await saveChecklist(items);
  return items.length;
}

export async function completeChecklistItem(itemKey: string, actor: string, notes?: string): Promise<ChecklistItem | null> {
  const items = await getChecklist();
  const item = items.find(i => i.itemKey === itemKey);
  if (!item) return null;
  item.completed = true;
  item.completedBy = actor;
  item.completedAt = new Date().toISOString();
  if (notes) item.notes = notes;
  await saveChecklist(items);
  await logAuditEvent({
    actor,
    eventType: 'checklist_item_completed',
    targetType: 'go-live-checklist',
    targetId: itemKey,
    summary: `Checklist completed: ${item.label}`,
  });
  return item;
}

export function getChecklistProgress(items: ChecklistItem[]): { total: number; completed: number; percent: number } {
  const completed = items.filter(i => i.completed).length;
  return { total: items.length, completed, percent: items.length > 0 ? Math.round((completed / items.length) * 100) : 0 };
}

/* ------------------------------------------------------------------ */
/*  Launch signoff                                                      */
/* ------------------------------------------------------------------ */

export async function requestLaunchSignoff(requestedBy: string, notes?: string): Promise<LaunchSignoff> {
  const redis = getRedis();
  const checklist = await getChecklist();
  const signoff: LaunchSignoff = {
    id: `lsig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
    requestedBy,
    notes,
    checklistSnapshot: { items: checklist, progress: getChecklistProgress(checklist) },
  };
  await redis.set(`${SIGNOFF_PREFIX}${signoff.id}`, JSON.stringify(signoff));
  await redis.zadd(SIGNOFF_SET, { score: Date.now(), member: signoff.id });
  await logAuditEvent({
    actor: requestedBy,
    eventType: 'launch_signoff_requested',
    targetType: 'launch-signoff',
    targetId: signoff.id,
    summary: `Launch signoff requested by ${requestedBy}`,
  });
  return signoff;
}

export async function approveLaunchSignoff(id: string, approvedBy: string, notes?: string): Promise<LaunchSignoff | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SIGNOFF_PREFIX}${id}`);
  if (!raw) return null;
  const signoff: LaunchSignoff = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (signoff.status !== 'pending') return signoff;
  // Dual-control: requester cannot self-approve
  if (signoff.requestedBy === approvedBy) return null;
  signoff.status = 'approved';
  signoff.approvedBy = approvedBy;
  if (notes) signoff.notes = (signoff.notes || '') + ` | Approved: ${notes}`;
  await redis.set(`${SIGNOFF_PREFIX}${id}`, JSON.stringify(signoff));
  await logAuditEvent({
    actor: approvedBy,
    eventType: 'launch_signoff_approved',
    targetType: 'launch-signoff',
    targetId: id,
    summary: `Launch signoff approved by ${approvedBy}`,
  });
  return signoff;
}

export async function rejectLaunchSignoff(id: string, rejectedBy: string, notes?: string): Promise<LaunchSignoff | null> {
  const redis = getRedis();
  const raw = await redis.get(`${SIGNOFF_PREFIX}${id}`);
  if (!raw) return null;
  const signoff: LaunchSignoff = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (signoff.status !== 'pending') return signoff;
  signoff.status = 'rejected';
  signoff.rejectedBy = rejectedBy;
  if (notes) signoff.notes = (signoff.notes || '') + ` | Rejected: ${notes}`;
  await redis.set(`${SIGNOFF_PREFIX}${id}`, JSON.stringify(signoff));
  await logAuditEvent({
    actor: rejectedBy,
    eventType: 'launch_signoff_rejected',
    targetType: 'launch-signoff',
    targetId: id,
    summary: `Launch signoff rejected by ${rejectedBy}`,
  });
  return signoff;
}

export async function listLaunchSignoffs(limit = 20): Promise<LaunchSignoff[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SIGNOFF_SET, 0, limit - 1, { rev: true }) || [];
  const results: LaunchSignoff[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SIGNOFF_PREFIX}${id}`);
    if (raw) results.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Launch state                                                        */
/* ------------------------------------------------------------------ */

const VALID_TRANSITIONS: Record<LaunchState, LaunchState[]> = {
  prelaunch: ['ready', 'launch_blocked'],
  ready: ['locked_for_launch', 'launch_blocked', 'prelaunch'],
  locked_for_launch: ['launched', 'launch_blocked', 'ready'],
  launched: ['launch_blocked'],
  launch_blocked: ['prelaunch', 'ready'],
};

export async function getLaunchState(): Promise<LaunchState> {
  const redis = getRedis();
  const raw = await redis.get(STATE_KEY);
  if (!raw) return 'prelaunch';
  return (typeof raw === 'string' ? raw : 'prelaunch') as LaunchState;
}

export async function updateLaunchState(newState: LaunchState, actor: string): Promise<{ ok: boolean; state: LaunchState; error?: string }> {
  const current = await getLaunchState();
  const allowed = VALID_TRANSITIONS[current] || [];
  if (!allowed.includes(newState)) {
    return { ok: false, state: current, error: `Cannot transition from ${current} to ${newState}. Allowed: ${allowed.join(', ')}` };
  }
  const redis = getRedis();
  await redis.set(STATE_KEY, newState);
  await logAuditEvent({
    actor,
    eventType: 'launch_state_changed',
    targetType: 'launch-state',
    targetId: newState,
    summary: `Launch state: ${current} → ${newState}`,
  });
  return { ok: true, state: newState };
}

export function getAllowedTransitions(state: LaunchState): LaunchState[] {
  return VALID_TRANSITIONS[state] || [];
}
