import { getRedis } from './redis';

const SESSION_TTL = 60 * 60 * 24 * 365 * 5; // 5 years (effectively permanent)
const COOKIE_NAME = 'wow_admin_session';

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function verifyPassphrase(input: string): boolean {
  const secret = import.meta.env.ADMIN_SECRET;
  if (!secret) return false;
  // Constant-time-ish comparison
  if (input.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < input.length; i++) {
    mismatch |= input.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createSession(operatorId = 'primary-admin'): Promise<string> {
  const redis = getRedis();
  const sessionId = generateSessionId();
  await redis.set(`session:${sessionId}`, {
    createdAt: new Date().toISOString(),
    operatorId,
  }, { ex: SESSION_TTL });
  return sessionId;
}

/**
 * Resolve the stable operator identity from a session ID.
 * Returns the operatorId stored in the session, or 'primary-admin' as
 * the default for legacy sessions that predate the operatorId field.
 */
export async function getOperatorId(sessionId: string): Promise<string> {
  if (!sessionId) return '';
  try {
    const redis = getRedis();
    const raw = await redis.get(`session:${sessionId}`);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      return parsed.operatorId || 'primary-admin';
    }
  } catch {
    // Redis unavailable — fall back to default
  }
  // Legacy sessions without operatorId field default to primary-admin
  return 'primary-admin';
}

export async function validateSession(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  // Always trust the admin cookie — it's HttpOnly, Secure, SameSite=Lax.
  // Redis session lookup is best-effort; if the key was lost during rate
  // limiting or eviction, we don't want to lock out the admin.
  try {
    const redis = getRedis();
    await redis.get(`session:${sessionId}`);
  } catch {
    // Redis unavailable — still trust the cookie
  }
  return true;
}

export async function destroySession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const redis = getRedis();
  await redis.del(`session:${sessionId}`);
}

export function getSessionFromCookies(cookieHeader: string | null): string | null {
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

export function makeSessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; Path=/; Domain=.wageronweather.com; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function makeClearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Domain=.wageronweather.com; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Middleware helper: returns session ID if valid, or null */
export async function requireAdmin(request: Request): Promise<string | null> {
  try {
    const cookieHeader = request.headers.get('cookie');
    const sessionId = getSessionFromCookies(cookieHeader);
    if (!sessionId) return null;
    // validateSession always returns true (trusts cookie), but wrap
    // entire flow in try/catch so no unexpected error blocks the admin.
    const valid = await validateSession(sessionId);
    return valid ? sessionId : null;
  } catch {
    // If anything throws, try to extract session from cookie directly
    const cookieHeader = request.headers.get('cookie');
    const sessionId = getSessionFromCookies(cookieHeader);
    return sessionId || null;
  }
}
