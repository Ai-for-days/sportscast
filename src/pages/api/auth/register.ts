import type { APIRoute } from 'astro';
import { hashPassword, createUserSession, makeUserSessionCookie } from '../../../lib/user-auth';
import { createUser, getUserByEmail } from '../../../lib/user-store';
import { getRedis } from '../../../lib/redis';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { email, password, displayName } = body as {
      email?: string;
      password?: string;
      displayName?: string;
    };

    // Validate inputs
    if (!email || !password || !displayName) {
      return new Response(JSON.stringify({ error: 'Email, password, and display name are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const emailLower = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (displayName.trim().length < 2 || displayName.trim().length > 50) {
      return new Response(JSON.stringify({ error: 'Display name must be 2-50 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Rate limit: 3 registrations per hour per IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const redis = getRedis();
    const regKey = `ratelimit:register:${ip}`;
    const regCount = await redis.incr(regKey);
    if (regCount === 1) await redis.expire(regKey, 3600);
    if (regCount > 3) {
      return new Response(JSON.stringify({ error: 'Too many registrations. Try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if email already exists
    const existing = await getUserByEmail(emailLower);
    if (existing) {
      return new Response(JSON.stringify({ error: 'An account with this email already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const user = await createUser({
      email: emailLower,
      displayName: displayName.trim(),
      passwordHash,
    });

    // Create session
    const sessionId = await createUserSession(user.id);

    return new Response(JSON.stringify({ ok: true, user: { id: user.id, email: user.email, displayName: user.displayName } }), {
      status: 201,
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
