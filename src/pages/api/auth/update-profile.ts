import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getUserById } from '../../../lib/user-store';
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
    const { displayName } = body as { displayName?: string };

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 50) {
      return new Response(JSON.stringify({ error: 'Display name must be 2-50 characters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const redis = getRedis();
    const updated = { ...user, displayName: displayName.trim() };
    await redis.set(`user:${user.id}`, JSON.stringify(updated));

    return new Response(JSON.stringify({ ok: true, displayName: updated.displayName }), {
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
