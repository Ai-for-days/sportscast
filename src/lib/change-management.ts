import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type ChangeCategory = 'config' | 'model' | 'permissions' | 'execution' | 'pricing' | 'ops' | 'release';
export type ChangeSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ChangeStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'implemented' | 'rolled_back';

export interface ChangeRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  category: ChangeCategory;
  severity: ChangeSeverity;
  status: ChangeStatus;
  requestedBy: string;
  approvedBy?: string;
  implementedBy?: string;
  description: string;
  changeSummary?: string;
  rollbackPlan?: string;
  notes: string[];
  linkedReleaseId?: string;
  linkedApprovalId?: string;
}

const CR_PREFIX = 'cr:';
const CR_SET = 'change-requests:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveCR(cr: ChangeRequest): Promise<void> {
  const redis = getRedis();
  await redis.set(`${CR_PREFIX}${cr.id}`, JSON.stringify(cr));
  await redis.zadd(CR_SET, { score: Date.now(), member: cr.id });
}

export async function getChangeRequest(id: string): Promise<ChangeRequest | null> {
  const redis = getRedis();
  const raw = await redis.get(`${CR_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as ChangeRequest;
}

export async function listChangeRequests(limit = 100): Promise<ChangeRequest[]> {
  const redis = getRedis();
  const ids = await redis.zrange(CR_SET, 0, limit - 1, { rev: true }) || [];
  const results: ChangeRequest[] = [];
  for (const id of ids) {
    const cr = await getChangeRequest(id);
    if (cr) results.push(cr);
  }
  return results;
}

export async function createChangeRequest(input: {
  title: string;
  category: ChangeCategory;
  severity: ChangeSeverity;
  requestedBy: string;
  description: string;
  changeSummary?: string;
  rollbackPlan?: string;
}): Promise<ChangeRequest> {
  const now = new Date().toISOString();
  const cr: ChangeRequest = {
    id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    title: input.title,
    category: input.category,
    severity: input.severity,
    status: 'draft',
    requestedBy: input.requestedBy,
    description: input.description,
    changeSummary: input.changeSummary,
    rollbackPlan: input.rollbackPlan,
    notes: [],
  };
  await saveCR(cr);
  await logAuditEvent({
    actor: input.requestedBy,
    eventType: 'change_request_created',
    targetType: 'change-request',
    targetId: cr.id,
    summary: `CR created: ${cr.title} (${cr.category}/${cr.severity})`,
  });
  return cr;
}

export async function updateChangeRequestStatus(id: string, status: ChangeStatus, actor: string): Promise<ChangeRequest | null> {
  const cr = await getChangeRequest(id);
  if (!cr) return null;
  const prev = cr.status;
  cr.status = status;
  cr.updatedAt = new Date().toISOString();
  if (status === 'approved') cr.approvedBy = actor;
  if (status === 'implemented') cr.implementedBy = actor;
  await saveCR(cr);

  const eventMap: Record<string, string> = {
    pending_approval: 'change_request_created',
    approved: 'change_request_approved',
    rejected: 'change_request_rejected',
    implemented: 'change_request_implemented',
    rolled_back: 'change_request_implemented',
  };
  await logAuditEvent({
    actor,
    eventType: eventMap[status] || 'change_request_updated',
    targetType: 'change-request',
    targetId: cr.id,
    summary: `CR ${cr.id}: ${prev} → ${status}`,
  });
  return cr;
}

export async function addChangeRequestNote(id: string, note: string): Promise<ChangeRequest | null> {
  const cr = await getChangeRequest(id);
  if (!cr) return null;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  cr.notes.push(`[${ts}] ${note}`);
  cr.updatedAt = new Date().toISOString();
  await saveCR(cr);
  return cr;
}

export async function linkChangeToRelease(crId: string, releaseId: string): Promise<ChangeRequest | null> {
  const cr = await getChangeRequest(crId);
  if (!cr) return null;
  cr.linkedReleaseId = releaseId;
  cr.updatedAt = new Date().toISOString();
  await saveCR(cr);
  return cr;
}

export async function getChangeRequestSummary(): Promise<{
  total: number; draft: number; pendingApproval: number; approved: number;
  implemented: number; rejected: number; rolledBack: number;
}> {
  const all = await listChangeRequests(200);
  return {
    total: all.length,
    draft: all.filter(c => c.status === 'draft').length,
    pendingApproval: all.filter(c => c.status === 'pending_approval').length,
    approved: all.filter(c => c.status === 'approved').length,
    implemented: all.filter(c => c.status === 'implemented').length,
    rejected: all.filter(c => c.status === 'rejected').length,
    rolledBack: all.filter(c => c.status === 'rolled_back').length,
  };
}
