import type { APIRoute } from 'astro';
import { getSessionFromCookies, destroySession, makeClearCookie } from '../../../lib/admin-auth';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  const sessionId = getSessionFromCookies(cookieHeader);

  if (sessionId) {
    await destroySession(sessionId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': makeClearCookie(),
    },
  });
};
