import { getRedis } from './redis';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuditEvent {
  id: string;
  createdAt: string;
  actor: string;
  eventType: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  details?: any;
}

const AUDIT_SORTED_SET = 'audit:events';
const AUDIT_KEY_PREFIX = 'audit:event:';
const MAX_EVENTS = 500;

/* ------------------------------------------------------------------ */
/*  Write                                                              */
/* ------------------------------------------------------------------ */

export async function logAuditEvent(
  event: Omit<AuditEvent, 'id' | 'createdAt'>
): Promise<AuditEvent> {
  const redis = getRedis();
  const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  const entry: AuditEvent = { id, createdAt: now, ...event };
  await redis.set(`${AUDIT_KEY_PREFIX}${id}`, JSON.stringify(entry));
  await redis.zadd(AUDIT_SORTED_SET, { score: Date.now(), member: id });

  // Trim old events
  const count = await redis.zcard(AUDIT_SORTED_SET);
  if (count > MAX_EVENTS) {
    const toRemove = await redis.zrange(AUDIT_SORTED_SET, 0, count - MAX_EVENTS - 1);
    for (const rid of toRemove) {
      await redis.del(`${AUDIT_KEY_PREFIX}${rid}`);
    }
    await redis.zremrangebyrank(AUDIT_SORTED_SET, 0, count - MAX_EVENTS - 1);
  }

  return entry;
}

/* ------------------------------------------------------------------ */
/*  Read                                                               */
/* ------------------------------------------------------------------ */

export async function listAuditEvents(limit = 50): Promise<AuditEvent[]> {
  const redis = getRedis();
  const ids = await redis.zrange(AUDIT_SORTED_SET, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];

  const sliced = ids.slice(0, limit);
  const events: AuditEvent[] = [];
  for (const id of sliced) {
    const raw = await redis.get(`${AUDIT_KEY_PREFIX}${id}`);
    if (raw) {
      events.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as AuditEvent);
    }
  }
  return events;
}
