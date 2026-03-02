import type { APIRoute } from 'astro';
import { verifyPassword, createUserSession, makeUserSessionCookie } from '../../../lib/user-auth';
import { getUserByEmail } from '../../../lib/user-store';
import { getRedis } from '../../../lib/redis';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const emailLower = email.toLowerCase().trim();

    // Rate limit: 5 login attempts per 15min per email
    const redis = getRedis();
    const loginKey = `ratelimit:login:${emailLower}`;
    const loginCount = await redis.incr(loginKey);
    if (loginCount === 1) await redis.expire(loginKey, 900);
    if (loginCount > 5) {
      return new Response(JSON.stringify({ error: 'Too many login attempts. Try again in 15 minutes.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = await getUserByEmail(emailLower);
    if (!user || !user.passwordHash) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionId = await createUserSession(user.id);

    return new Response(JSON.stringify({ ok: true, user: { id: user.id, email: user.email, displayName: user.displayName } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': makeUserSessionCookie(sessionId),
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
