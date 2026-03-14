import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'mitigated' | 'resolved' | 'closed';
export type IncidentCategory = 'execution' | 'pricing' | 'data' | 'security' | 'reconciliation' | 'settlement' | 'ops';

export interface Incident {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  category: IncidentCategory;
  sourceAlertId?: string;
  description: string;
  owner?: string;
  notes: string[];
  linkedRunbookId?: string;
  linkedPages?: string[];
}

const PREFIX = 'incident:';
const SET = 'incidents:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveIncident(inc: Incident): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX}${inc.id}`, JSON.stringify(inc));
  await redis.zadd(SET, { score: Date.now(), member: inc.id });
}

export async function getIncident(id: string): Promise<Incident | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as Incident;
}

export async function listIncidents(limit = 100): Promise<Incident[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SET, 0, limit - 1, { rev: true }) || [];
  const results: Incident[] = [];
  for (const id of ids) {
    const inc = await getIncident(id);
    if (inc) results.push(inc);
  }
  return results;
}

export async function createIncident(input: {
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  description: string;
  owner?: string;
  sourceAlertId?: string;
  linkedRunbookId?: string;
  linkedPages?: string[];
}): Promise<Incident> {
  const now = new Date().toISOString();
  const inc: Incident = {
    id: `inc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    title: input.title,
    severity: input.severity,
    status: 'open',
    category: input.category,
    description: input.description,
    owner: input.owner,
    sourceAlertId: input.sourceAlertId,
    linkedRunbookId: input.linkedRunbookId,
    linkedPages: input.linkedPages,
    notes: [],
  };
  await saveIncident(inc);
  await logAuditEvent({
    actor: input.owner || 'admin',
    eventType: 'incident_created',
    targetType: 'incident',
    targetId: inc.id,
    summary: `Incident created: ${inc.title} (${inc.severity})`,
  });
  return inc;
}

export async function updateIncident(id: string, updates: {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  owner?: string;
  linkedRunbookId?: string;
}): Promise<Incident | null> {
  const inc = await getIncident(id);
  if (!inc) return null;
  if (updates.status) inc.status = updates.status;
  if (updates.severity) inc.severity = updates.severity;
  if (updates.owner !== undefined) inc.owner = updates.owner;
  if (updates.linkedRunbookId !== undefined) inc.linkedRunbookId = updates.linkedRunbookId;
  inc.updatedAt = new Date().toISOString();
  await saveIncident(inc);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'incident_updated',
    targetType: 'incident',
    targetId: inc.id,
    summary: `Incident updated: status=${inc.status}, severity=${inc.severity}`,
  });
  return inc;
}

export async function addIncidentNote(id: string, note: string): Promise<Incident | null> {
  const inc = await getIncident(id);
  if (!inc) return null;
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  inc.notes.push(`[${timestamp}] ${note}`);
  inc.updatedAt = new Date().toISOString();
  await saveIncident(inc);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'incident_note_added',
    targetType: 'incident',
    targetId: inc.id,
    summary: `Note added to incident: ${note.slice(0, 60)}`,
  });
  return inc;
}

export async function getIncidentSummary(): Promise<{
  total: number; open: number; investigating: number; mitigated: number;
  critical: number; high: number; withoutOwner: number;
}> {
  const all = await listIncidents();
  const active = all.filter(i => i.status !== 'closed' && i.status !== 'resolved');
  return {
    total: all.length,
    open: active.filter(i => i.status === 'open').length,
    investigating: active.filter(i => i.status === 'investigating').length,
    mitigated: active.filter(i => i.status === 'mitigated').length,
    critical: active.filter(i => i.severity === 'critical' && i.status !== 'closed' && i.status !== 'resolved').length,
    high: active.filter(i => i.severity === 'high' && i.status !== 'closed' && i.status !== 'resolved').length,
    withoutOwner: active.filter(i => !i.owner).length,
  };
}
