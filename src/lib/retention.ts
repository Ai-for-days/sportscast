import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface RetentionPolicy {
  family: string;
  retentionDays: number;
  immutable: boolean;
  exportable: boolean;
  notes?: string;
}

const POLICIES_KEY = 'retention:policies';

/* ------------------------------------------------------------------ */
/*  Default policies                                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_POLICIES: RetentionPolicy[] = [
  { family: 'audit_events', retentionDays: 365, immutable: true, exportable: true, notes: 'Core audit trail — immutable' },
  { family: 'security_events', retentionDays: 365, immutable: true, exportable: true, notes: 'Security activity — immutable' },
  { family: 'approvals', retentionDays: 365, immutable: true, exportable: true, notes: 'Approval decisions — immutable for compliance' },
  { family: 'incidents', retentionDays: 365, immutable: false, exportable: true, notes: 'Incident records — mutable status but preserved' },
  { family: 'handoffs', retentionDays: 180, immutable: false, exportable: true, notes: 'Shift handoff notes' },
  { family: 'signoffs', retentionDays: 365, immutable: true, exportable: true, notes: 'Daily signoff records — immutable' },
  { family: 'change_requests', retentionDays: 365, immutable: false, exportable: true, notes: 'Change management records' },
  { family: 'releases', retentionDays: 365, immutable: false, exportable: true, notes: 'Release log entries' },
  { family: 'notifications', retentionDays: 90, immutable: false, exportable: true, notes: 'Notification delivery history' },
  { family: 'settlements', retentionDays: 730, immutable: true, exportable: true, notes: 'Settlement/accounting records — 2 year retention' },
  { family: 'reconciliation', retentionDays: 365, immutable: false, exportable: true, notes: 'Reconciliation records' },
  { family: 'model_governance', retentionDays: 365, immutable: false, exportable: true, notes: 'Model versions, experiments, promotions' },
  { family: 'history_snapshots', retentionDays: 730, immutable: true, exportable: true, notes: 'Research store snapshots — immutable, 2 year' },
  { family: 'resilience_drills', retentionDays: 365, immutable: false, exportable: true, notes: 'Resilience drill records' },
];

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function getRetentionPolicies(): Promise<RetentionPolicy[]> {
  const redis = getRedis();
  const raw = await redis.get(POLICIES_KEY);
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw as RetentionPolicy[];
}

async function savePolicies(policies: RetentionPolicy[]): Promise<void> {
  const redis = getRedis();
  await redis.set(POLICIES_KEY, JSON.stringify(policies));
}

export async function seedDefaultPolicies(): Promise<number> {
  const existing = await getRetentionPolicies();
  if (existing.length > 0) return 0;
  await savePolicies(DEFAULT_POLICIES);
  return DEFAULT_POLICIES.length;
}

export async function updateRetentionPolicy(family: string, updates: {
  retentionDays?: number;
  immutable?: boolean;
  exportable?: boolean;
  notes?: string;
}): Promise<RetentionPolicy | null> {
  const policies = await getRetentionPolicies();
  const policy = policies.find(p => p.family === family);
  if (!policy) return null;
  if (updates.retentionDays !== undefined) policy.retentionDays = updates.retentionDays;
  if (updates.immutable !== undefined) policy.immutable = updates.immutable;
  if (updates.exportable !== undefined) policy.exportable = updates.exportable;
  if (updates.notes !== undefined) policy.notes = updates.notes;
  await savePolicies(policies);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'retention_policy_updated',
    targetType: 'retention-policy',
    targetId: family,
    summary: `Retention policy updated: ${family} — ${policy.retentionDays}d, immutable=${policy.immutable}`,
  });
  return policy;
}
