import type { APIRoute } from 'astro';
import { requireUser, destroyUserSession, getUserSessionFromCookies, makeClearUserCookie } from '../../../lib/user-auth';
import { deleteUser } from '../../../lib/user-store';

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
    const { confirm } = body as { confirm?: string };

    if (confirm !== 'DELETE') {
      return new Response(JSON.stringify({ error: 'Must send confirm: "DELETE" to confirm account deletion' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Destroy session
    const sessionId = getUserSessionFromCookies(request.headers.get('cookie'));
    if (sessionId) await destroyUserSession(sessionId);

    // Delete user and associated data
    await deleteUser(user.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': makeClearUserCookie(),
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
