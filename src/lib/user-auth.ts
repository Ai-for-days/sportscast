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
  return sessionId;
}

export async function validateUserSession(sessionId: string): Promise<UserSession | null> {
  if (!sessionId) return null;
  const redis = getRedis();
  const raw = await redis.get(`user-session:${sessionId}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as UserSession;
}

export async function destroyUserSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const redis = getRedis();
  await redis.del(`user-session:${sessionId}`);
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
  const sessionId = getUserSessionFromCookies(cookieHeader);
  if (!sessionId) return null;
  const session = await validateUserSession(sessionId);
  if (!session) return null;
  return getUserById(session.userId);
}
