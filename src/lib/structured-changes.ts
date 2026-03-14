import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface StructuredChange {
  id: string;
  createdAt: string;
  changeType: string;
  targetType: string;
  targetId?: string;
  before?: any;
  after?: any;
  actor: string;
  relatedChangeRequestId?: string;
}

const SC_PREFIX = 'schange:';
const SC_SET = 'structured-changes:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveChange(sc: StructuredChange): Promise<void> {
  const redis = getRedis();
  await redis.set(`${SC_PREFIX}${sc.id}`, JSON.stringify(sc));
  await redis.zadd(SC_SET, { score: Date.now(), member: sc.id });
}

export async function listStructuredChanges(limit = 100): Promise<StructuredChange[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SC_SET, 0, limit - 1, { rev: true }) || [];
  const results: StructuredChange[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${SC_PREFIX}${id}`);
    if (!raw) continue;
    results.push(typeof raw === 'string' ? JSON.parse(raw) : raw as StructuredChange);
  }
  return results;
}

export async function recordStructuredChange(input: {
  changeType: string;
  targetType: string;
  targetId?: string;
  before?: any;
  after?: any;
  actor: string;
  relatedChangeRequestId?: string;
}): Promise<StructuredChange> {
  const sc: StructuredChange = {
    id: `sc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    changeType: input.changeType,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before,
    after: input.after,
    actor: input.actor,
    relatedChangeRequestId: input.relatedChangeRequestId,
  };
  await saveChange(sc);
  await logAuditEvent({
    actor: input.actor,
    eventType: 'structured_change_recorded',
    targetType: input.targetType,
    targetId: input.targetId || sc.id,
    summary: `${input.changeType}: ${input.targetType}${input.targetId ? ':' + input.targetId : ''}`,
  });
  return sc;
}
