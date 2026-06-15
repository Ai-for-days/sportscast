import type { APIRoute } from 'astro';
import { createSession, makeSessionCookie } from '../../../lib/admin-auth';
import { completeRequiredPasswordReset } from '../../../lib/admin-account-store';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const token = String(body?.token ?? '');
    const password = String(body?.password ?? '');

    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing reset token.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await completeRequiredPasswordReset(token, password);
    if (!result.ok || !result.account) {
      return new Response(JSON.stringify({ error: result.error ?? 'Could not reset password.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const readOnly = result.account.role === 'viewer';
    const sessionId = await createSession(result.account.id, readOnly);
    return new Response(JSON.stringify({ ok: true, readOnly }), {
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
