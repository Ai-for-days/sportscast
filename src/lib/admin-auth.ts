import { getRedis as realGetRedis } from './redis';

// Test seam (2026-11-15): lets tests swap the session store. Production uses the real one.
type SessionStore = { get: (k: string) => Promise<unknown>; set: (...a: any[]) => Promise<unknown>; del: (k: string) => Promise<unknown> };
let getRedis: () => SessionStore = () => realGetRedis() as unknown as SessionStore;
export function __setAdminAuthStoreForTests(fn: (() => SessionStore) | null): void {
  getRedis = fn ?? (() => realGetRedis() as unknown as SessionStore);
}

const SESSION_TTL = 60 * 60 * 24 * 365 * 5; // 5 years (effectively permanent)
const COOKIE_NAME = 'wow_admin_session';

function generateSessionId(): string {
  // Cryptographic randomness (was Math.random, which is predictable).
  // Same 32-character [a-z0-9] format as before.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function verifyPassphrase(input: string): boolean {
  const secret = import.meta.env.ADMIN_SECRET;
  if (!secret) return false;
  return constantTimeCompare(input, secret);
}

export function verifyViewerPassphrase(input: string): boolean {
  const secret = import.meta.env.ADMIN_VIEWER_SECRET;
  if (!secret) return false;
  return constantTimeCompare(input, secret);
}

export async function createSession(operatorId = 'primary-admin', readOnly = false): Promise<string> {
  const redis = getRedis();
  const sessionId = generateSessionId();
  await redis.set(`session:${sessionId}`, {
    createdAt: new Date().toISOString(),
    operatorId,
    readOnly,
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

/**
 * Check if the session is read-only (viewer mode).
 */
export async function isReadOnly(sessionId: string): Promise<boolean> {
  if (!sessionId) return true;
  try {
    const redis = getRedis();
    const raw = await redis.get(`session:${sessionId}`);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as any;
      return parsed.readOnly === true;
    }
  } catch {
    // Redis unavailable — default to read-only for safety
  }
  return false;
}

/**
 * A session is valid only if the session store holds it (createSession wrote
 * it at login). Fails closed: a missing key or an unreachable store means not
 * logged in.
 *
 * Until 2026-11-15 this always returned true ("always trust the admin
 * cookie", 46f4e52, 2026-03-08), so ANY value of the cookie passed every
 * admin page and /api/admin route, and the cookie name is in this public
 * repo. If a real session key is ever lost, the admin simply logs in again.
 */
export async function validateSession(sessionId: string): Promise<boolean> {
  if (!sessionId || !/^[a-z0-9]{16,128}$/.test(sessionId)) return false;
  try {
    const raw = await getRedis().get(`session:${sessionId}`);
    return raw !== null && raw !== undefined;
  } catch {
    return false;
  }
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
  const isDev = !import.meta.env.PROD;
  const domain = isDev ? '' : 'Domain=.wageronweather.com; ';
  const secure = isDev ? '' : 'Secure; ';
  return `${COOKIE_NAME}=${sessionId}; Path=/; ${domain}HttpOnly; ${secure}SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function makeClearCookie(): string {
  const isDev = !import.meta.env.PROD;
  const domain = isDev ? '' : 'Domain=.wageronweather.com; ';
  const secure = isDev ? '' : 'Secure; ';
  return `${COOKIE_NAME}=; Path=/; ${domain}HttpOnly; ${secure}SameSite=Lax; Max-Age=0`;
}

/** Middleware helper: returns session ID if valid, or null */
export async function requireAdmin(request: Request): Promise<string | null> {
  try {
    const cookieHeader = request.headers.get('cookie');
    const sessionId = getSessionFromCookies(cookieHeader);
    if (!sessionId) return null;
    const valid = await validateSession(sessionId);
    return valid ? sessionId : null;
  } catch {
    // Fail closed: an unexpected error is never a login.
    return null;
  }
}
