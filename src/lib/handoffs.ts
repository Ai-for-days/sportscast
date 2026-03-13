import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface Handoff {
  id: string;
  createdAt: string;
  operator: string;
  summary: string;
  openIssues: string[];
  priorityItems: string[];
  pnlSummary?: string;
  riskSummary?: string;
  notes?: string;
}

const PREFIX = 'handoff:';
const SET = 'handoffs:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveHandoff(h: Handoff): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX}${h.id}`, JSON.stringify(h));
  await redis.zadd(SET, { score: Date.now(), member: h.id });
}

export async function getHandoff(id: string): Promise<Handoff | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as Handoff;
}

export async function listHandoffs(limit = 20): Promise<Handoff[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SET, 0, limit - 1, { rev: true }) || [];
  const results: Handoff[] = [];
  for (const id of ids) {
    const h = await getHandoff(id);
    if (h) results.push(h);
  }
  return results;
}

export async function createHandoff(input: {
  operator: string;
  summary: string;
  openIssues: string[];
  priorityItems: string[];
  pnlSummary?: string;
  riskSummary?: string;
  notes?: string;
}): Promise<Handoff> {
  const h: Handoff = {
    id: `ho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    operator: input.operator,
    summary: input.summary,
    openIssues: input.openIssues,
    priorityItems: input.priorityItems,
    pnlSummary: input.pnlSummary,
    riskSummary: input.riskSummary,
    notes: input.notes,
  };
  await saveHandoff(h);
  await logAuditEvent({
    actor: input.operator,
    eventType: 'handoff_created',
    targetType: 'handoff',
    targetId: h.id,
    summary: `Shift handoff by ${input.operator}: ${input.summary.slice(0, 60)}`,
  });
  return h;
}
