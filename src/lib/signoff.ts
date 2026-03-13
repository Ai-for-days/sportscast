import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type SignoffType = 'preopen' | 'midday' | 'eod' | 'reconciliation' | 'settlement';

export interface Signoff {
  id: string;
  createdAt: string;
  date: string;
  signoffType: SignoffType;
  actor: string;
  status: 'completed';
  notes?: string;
}

const PREFIX = 'signoff:';
const SET = 'signoffs:all';

export const SIGNOFF_TYPES: { type: SignoffType; label: string }[] = [
  { type: 'preopen', label: 'Pre-Open Review' },
  { type: 'midday', label: 'Midday Check' },
  { type: 'eod', label: 'End-of-Day Review' },
  { type: 'reconciliation', label: 'Reconciliation Review' },
  { type: 'settlement', label: 'Settlement / Accounting Review' },
];

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveSignoff(s: Signoff): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX}${s.id}`, JSON.stringify(s));
  await redis.zadd(SET, { score: Date.now(), member: s.id });
}

export async function listSignoffs(limit = 50): Promise<Signoff[]> {
  const redis = getRedis();
  const ids = await redis.zrange(SET, 0, limit - 1, { rev: true }) || [];
  const results: Signoff[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${PREFIX}${id}`);
    if (!raw) continue;
    results.push(typeof raw === 'string' ? JSON.parse(raw) : raw as Signoff);
  }
  return results;
}

export async function createSignoff(input: {
  signoffType: SignoffType;
  actor: string;
  notes?: string;
}): Promise<Signoff> {
  const now = new Date();
  const s: Signoff = {
    id: `so-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    signoffType: input.signoffType,
    actor: input.actor,
    status: 'completed',
    notes: input.notes,
  };
  await saveSignoff(s);
  await logAuditEvent({
    actor: input.actor,
    eventType: 'signoff_created',
    targetType: 'signoff',
    targetId: s.id,
    summary: `Signoff: ${input.signoffType} by ${input.actor}`,
  });
  return s;
}

export async function getTodaySignoffs(): Promise<Signoff[]> {
  const today = new Date().toISOString().slice(0, 10);
  const all = await listSignoffs(100);
  return all.filter(s => s.date === today);
}

export async function getMissingSignoffs(): Promise<SignoffType[]> {
  const today = await getTodaySignoffs();
  const completed = new Set(today.map(s => s.signoffType));
  return SIGNOFF_TYPES.filter(t => !completed.has(t.type)).map(t => t.type);
}
