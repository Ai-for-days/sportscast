import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { getRedis } from './redis';
import type { User, UserSession } from './user-types';

const SESSION_TTL = 60 * 60 * 24 * 365 * 5; // 5 years (effectively permanent)
const COOKIE_NAME = 'wow_user_session';
const SALT_ROUNDS = 12;

// Session ids come from the OS's cryptographic generator (WOW-037; was Math.random).
// Same 32-character [a-z0-9] format, so existing sessions stay valid.
const SESSION_ID_RE = /^[a-z0-9]{32}$/;
function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[randomInt(chars.length)];
  }
  return id;
}

// ── Password hashing ────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── Session management ──────────────────────────────────────────────────────

export async function createUserSession(userId: string): Promise<string> {
  const redis = getRedis();
  const sessionId = generateSessionId();
  const session: UserSession = { userId, createdAt: new Date().toISOString() };
  await redis.set(`user-session:${sessionId}`, JSON.stringify(session), { ex: SESSION_TTL });
  // Cookie value = sessionId.userId so we can recover userId without Redis
  return `${sessionId}.${userId}`;
}

/**
 * A session is valid only if it is stored in Redis (WOW-037, 2026-11-20).
 *
 * Until now a missing session, or a Redis error, fell back to trusting the user
 * id written after the dot in the cookie (commit e4cc9ff, 2026-03-08, added so
 * that Google sign-in's "fallback" cookies, which were never stored, would work).
 * That made `anything.<someone's user id>` a valid login as that person. Fail
 * closed: no stored session means signed out. The id after the dot is only a
 * cross-check; if it is present and differs from the stored session, reject.
 */
export async function validateUserSession(cookieValue: string): Promise<UserSession | null> {
  if (!cookieValue) return null;
  // Cookie value format: "sessionId.userId" (new) or just "sessionId" (legacy)
  const dotIdx = cookieValue.indexOf('.');
  const sessionId = dotIdx >= 0 ? cookieValue.slice(0, dotIdx) : cookieValue;
  const embeddedUserId = dotIdx >= 0 ? cookieValue.slice(dotIdx + 1) : null;
  if (!SESSION_ID_RE.test(sessionId)) return null;

  let session: UserSession | null = null;
  try {
    const raw = await getRedis().get(`user-session:${sessionId}`);
    if (!raw) return null;
    session = typeof raw === 'string' ? JSON.parse(raw) : (raw as unknown as UserSession);
  } catch {
    return null;
  }
  if (!session || typeof session.userId !== 'string' || !session.userId) return null;
  if (embeddedUserId && embeddedUserId !== session.userId) return null;
  return session;
}

export async function destroyUserSession(cookieValue: string): Promise<void> {
  if (!cookieValue) return;
  // Extract sessionId from "sessionId.userId" or plain "sessionId"
  const dotIdx = cookieValue.indexOf('.');
  const sessionId = dotIdx >= 0 ? cookieValue.slice(0, dotIdx) : cookieValue;
  try {
    const redis = getRedis();
    await redis.del(`user-session:${sessionId}`);
  } catch { /* ignore Redis errors on logout */ }
}

// ── Cookie helpers ──────────────────────────────────────────────────────────

export function getUserSessionFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name === COOKIE_NAME) {
      return rest.join('=');
    }
  }
  return null;
}

export function makeUserSessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; Path=/; Domain=.wageronweather.com; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function makeClearUserCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Domain=.wageronweather.com; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ── Middleware helper ────────────────────────────────────────────────────────

/** Returns User object if valid session, or null */
export async function requireUser(request: Request): Promise<User | null> {
  const { getUserById } = await import('./user-store');
  const cookieHeader = request.headers.get('cookie');
  const cookieValue = getUserSessionFromCookies(cookieHeader);
  if (!cookieValue) return null;
  const session = await validateUserSession(cookieValue);
  if (!session || !session.userId) return null;
  try {
    return await getUserById(session.userId);
  } catch {
    // Fail closed (WOW-037): a made-up minimal user here dropped flags such as
    // `frozen`, letting a frozen player act during a Redis error.
    return null;
  }
}
