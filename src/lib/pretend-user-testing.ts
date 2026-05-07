// ── Step 119B Part A: Pretend User Testing (server-only) ────────────────────
//
// Sandboxed admin tool for exercising the public/customer flow as a fake
// user. Lives entirely in pretend-user-session:* keys — never touches
// wallet-store, bet-store, or any other real-money path. Balance tracked
// here is virtual (operator-tracked accounting only); no wallet writes.
//
// Bet placement is not implemented because the production bet path
// requires a real user + real balance. The UI surfaces this gap as a
// checklist item rather than fabricating a fake bet.

import { getRedis } from './redis';

if (typeof window !== 'undefined') {
  throw new Error(
    'pretend-user-testing is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export type TestSessionStatus = 'active' | 'closed';

export interface TestAction {
  at: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

export interface TestSession {
  id: string;
  createdAt: string;
  createdBy: string;
  pretendUserId: string;
  displayName: string;
  startingTestBalanceCents: number;
  currentTestBalanceCents: number;
  status: TestSessionStatus;
  notes: string[];
  actions: TestAction[];
}

export class PretendUserTestingError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  session: (id: string) => `pretend-user-session:${id}`,
  all: 'pretend-user-sessions:all',
  active: (pretendUserId: string) => `pretend-user-session:active:${pretendUserId}`,
};
const MAX_SESSIONS = 200;

// ── Helpers ─────────────────────────────────────────────────────────────────

function newSessionId(): string {
  return `puts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newPretendUserId(): string {
  return `pretend-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function readSession(id: string): Promise<TestSession | null> {
  const redis = getRedis();
  const raw = (await redis.get(KEY.session(id))) as string | null;
  if (!raw) return null;
  return JSON.parse(raw) as TestSession;
}

async function writeSession(session: TestSession): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY.session(session.id), JSON.stringify(session));
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  displayName?: string;
  startingTestBalanceCents?: number;
  pretendUserId?: string;
}

export async function createTestSession(
  input: CreateSessionInput,
  createdBy: string,
): Promise<TestSession> {
  const pretendUserId = input.pretendUserId?.trim() || newPretendUserId();
  const displayName = input.displayName?.trim() || `Pretend ${pretendUserId.slice(-6)}`;
  const balance = Math.max(0, Math.floor(input.startingTestBalanceCents ?? 100_000));
  const now = new Date().toISOString();

  const session: TestSession = {
    id: newSessionId(),
    createdAt: now,
    createdBy,
    pretendUserId,
    displayName,
    startingTestBalanceCents: balance,
    currentTestBalanceCents: balance,
    status: 'active',
    notes: [],
    actions: [
      {
        at: now,
        actor: createdBy,
        action: 'session_created',
        details: { pretendUserId, displayName, startingTestBalanceCents: balance },
      },
    ],
  };

  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.session(session.id), JSON.stringify(session));
  pipe.zadd(KEY.all, { score: Date.parse(now), member: session.id });
  pipe.zremrangebyrank(KEY.all, 0, -MAX_SESSIONS - 1);
  pipe.set(KEY.active(pretendUserId), session.id);
  await pipe.exec();

  return session;
}

export async function addSessionNote(
  id: string,
  note: string,
  actor: string,
): Promise<TestSession> {
  if (!note.trim()) {
    throw new PretendUserTestingError('Note text is required.', 'note_required');
  }
  const session = await readSession(id);
  if (!session) {
    throw new PretendUserTestingError(`Session ${id} not found.`, 'not_found');
  }
  if (session.status !== 'active') {
    throw new PretendUserTestingError('Cannot add a note to a closed session.', 'session_closed');
  }
  const now = new Date().toISOString();
  session.notes.push(note.trim());
  session.actions.push({ at: now, actor, action: 'note_added', details: { note: note.trim() } });
  await writeSession(session);
  return session;
}

export async function closeTestSession(
  id: string,
  actor: string,
  reason?: string,
): Promise<TestSession> {
  const session = await readSession(id);
  if (!session) {
    throw new PretendUserTestingError(`Session ${id} not found.`, 'not_found');
  }
  if (session.status === 'closed') return session;
  const now = new Date().toISOString();
  session.status = 'closed';
  session.actions.push({
    at: now,
    actor,
    action: 'session_closed',
    details: reason ? { reason } : undefined,
  });
  const redis = getRedis();
  const pipe = redis.pipeline();
  pipe.set(KEY.session(session.id), JSON.stringify(session));
  pipe.del(KEY.active(session.pretendUserId));
  await pipe.exec();
  return session;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listTestSessions(limit = 50): Promise<TestSession[]> {
  const redis = getRedis();
  const safe = Math.min(MAX_SESSIONS, Math.max(1, limit));
  const ids = (await redis.zrange(KEY.all, 0, safe - 1, { rev: true })) as string[];
  if (ids.length === 0) return [];
  const pipe = redis.pipeline();
  for (const id of ids) pipe.get(KEY.session(id));
  const rows = (await pipe.exec()) as Array<string | null>;
  return rows
    .filter((r): r is string => typeof r === 'string')
    .map((r) => JSON.parse(r) as TestSession);
}

export async function getTestSession(id: string): Promise<TestSession | null> {
  return readSession(id);
}

export async function getActiveSession(
  pretendUserId: string,
): Promise<TestSession | null> {
  const redis = getRedis();
  const id = (await redis.get(KEY.active(pretendUserId))) as string | null;
  if (!id) return null;
  return readSession(id);
}

export interface TestSessionSummary {
  total: number;
  active: number;
  closed: number;
  latest: TestSession | null;
}

export async function getTestSessionSummary(): Promise<TestSessionSummary> {
  const recent = await listTestSessions(100);
  let active = 0;
  let closed = 0;
  for (const s of recent) {
    if (s.status === 'active') active += 1;
    else closed += 1;
  }
  return { total: recent.length, active, closed, latest: recent[0] ?? null };
}
