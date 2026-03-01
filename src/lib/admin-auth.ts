import { getRedis } from './redis';

const SESSION_TTL = 60 * 60 * 24; // 24 hours
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

export async function createSession(): Promise<string> {
  const redis = getRedis();
  const sessionId = generateSessionId();
  await redis.set(`session:${sessionId}`, { createdAt: new Date().toISOString() }, { ex: SESSION_TTL });
  return sessionId;
}

export async function validateSession(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const redis = getRedis();
  const session = await redis.get(`session:${sessionId}`);
  return session !== null;
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
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function makeClearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Middleware helper: returns session ID if valid, or null */
export async function requireAdmin(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get('cookie');
  const sessionId = getSessionFromCookies(cookieHeader);
  if (!sessionId) return null;
  const valid = await validateSession(sessionId);
  return valid ? sessionId : null;
}
