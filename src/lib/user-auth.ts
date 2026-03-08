import bcrypt from 'bcryptjs';
import { getRedis } from './redis';
import type { User, UserSession } from './user-types';

const SESSION_TTL = 60 * 60 * 24 * 365 * 5; // 5 years (effectively permanent)
const COOKIE_NAME = 'wow_user_session';
const SALT_ROUNDS = 12;

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
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

export async function validateUserSession(cookieValue: string): Promise<UserSession | null> {
  if (!cookieValue) return null;
  // Cookie value format: "sessionId.userId" (new) or just "sessionId" (legacy)
  const dotIdx = cookieValue.indexOf('.');
  const sessionId = dotIdx >= 0 ? cookieValue.slice(0, dotIdx) : cookieValue;
  const embeddedUserId = dotIdx >= 0 ? cookieValue.slice(dotIdx + 1) : null;

  try {
    const redis = getRedis();
    const raw = await redis.get(`user-session:${sessionId}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as UserSession;
  } catch {
    // Redis unavailable — trust the embedded userId from the cookie
    if (embeddedUserId) {
      return { userId: embeddedUserId, createdAt: '' };
    }
    return null;
  }
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
    // Redis unavailable for user fetch — return minimal user from session
    return {
      id: session.userId,
      playerNumber: '',
      email: '',
      displayName: 'Player',
      createdAt: session.createdAt || '',
      emailVerified: false,
    };
  }
}
