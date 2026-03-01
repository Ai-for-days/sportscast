import type { APIRoute } from 'astro';
import { verifyPassphrase, createSession, makeSessionCookie } from '../../../lib/admin-auth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { passphrase } = body as { passphrase?: string };

    if (!passphrase || !verifyPassphrase(passphrase)) {
      return new Response(JSON.stringify({ error: 'Invalid passphrase' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionId = await createSession();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': makeSessionCookie(sessionId),
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
