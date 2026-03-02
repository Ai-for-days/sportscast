import type { APIRoute } from 'astro';
import { getUserSessionFromCookies, destroyUserSession, makeClearUserCookie } from '../../../lib/user-auth';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie');
  const sessionId = getUserSessionFromCookies(cookieHeader);

  if (sessionId) {
    await destroyUserSession(sessionId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': makeClearUserCookie(),
    },
  });
};
