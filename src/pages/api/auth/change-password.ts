import type { APIRoute } from 'astro';
import { requireUser, hashPassword, verifyPassword } from '../../../lib/user-auth';
import { getRedis } from '../../../lib/redis';

export const POST: APIRoute = async ({ request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body as { currentPassword?: string; newPassword?: string };

    if (!newPassword || newPassword.length < 8) {
      return new Response(JSON.stringify({ error: 'New password must be at least 8 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If user has a password, verify the current one
    if (user.passwordHash) {
      if (!currentPassword) {
        return new Response(JSON.stringify({ error: 'Current password is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return new Response(JSON.stringify({ error: 'Current password is incorrect' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const newHash = await hashPassword(newPassword);
    const redis = getRedis();
    const updated = { ...user, passwordHash: newHash };
    await redis.set(`user:${user.id}`, JSON.stringify(updated));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
