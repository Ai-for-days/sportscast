import type { APIRoute } from 'astro';
import { requireUser, hashPassword, verifyPassword, revokeOtherSessions, getUserSessionFromCookies } from '../../../lib/user-auth';
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

    if (typeof newPassword !== 'string' || newPassword.length < 8 || (currentPassword !== undefined && typeof currentPassword !== 'string')) {
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
      // A player replacing a temporary password must actually choose a new one
      // (WOW-036 review finding 7; set-password.astro checked this only in the browser).
      if (user.mustChangePassword && newPassword === currentPassword) {
        return new Response(JSON.stringify({ error: 'Choose a password different from the temporary one.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const newHash = await hashPassword(newPassword);
    const redis = getRedis();
    // Setting their own password clears the temporary-password flag (admin-added players).
    const updated = { ...user, passwordHash: newHash, mustChangePassword: false };
    await redis.set(`user:${user.id}`, JSON.stringify(updated));
    // Sign out every other session, e.g. one opened by someone else with the
    // texted temporary password (WOW-036 review finding 3). This session stays.
    try {
      await revokeOtherSessions(user.id, getUserSessionFromCookies(request.headers.get('cookie')));
    } catch (err: any) {
      console.error('[change-password] could not revoke other sessions:', err?.message);
    }

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
