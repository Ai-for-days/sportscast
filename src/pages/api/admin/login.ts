import type { APIRoute } from 'astro';
import { verifyPassphrase, verifyViewerPassphrase, createSession, makeSessionCookie } from '../../../lib/admin-auth';
import { bootstrapPrimaryAdmin } from '../../../lib/security-store';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { passphrase } = body as { passphrase?: string };

    if (!passphrase) {
      return new Response(JSON.stringify({ error: 'Invalid passphrase' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isAdmin = verifyPassphrase(passphrase);
    const isViewer = !isAdmin && verifyViewerPassphrase(passphrase);

    if (!isAdmin && !isViewer) {
      return new Response(JSON.stringify({ error: 'Invalid passphrase' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const readOnly = isViewer;
    const operatorId = isViewer ? 'viewer' : 'primary-admin';
    const sessionId = await createSession(operatorId, readOnly);

    // Bootstrap: auto-seed RBAC role for primary-admin if full admin login
    if (isAdmin) {
      await bootstrapPrimaryAdmin();
    }

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
