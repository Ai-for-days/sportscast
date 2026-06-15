import type { APIRoute } from 'astro';
import { verifyPassphrase, verifyViewerPassphrase, createSession, makeSessionCookie } from '../../../lib/admin-auth';
import { bootstrapPrimaryAdmin } from '../../../lib/security-store';
import { createRequiredPasswordResetToken, verifyAdminLogin } from '../../../lib/admin-account-store';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { username, passphrase } = body as { username?: string; passphrase?: string };

    if (!passphrase) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1) Owner / viewer shared-passphrase login (unchanged). The owner keeps
    //    logging in with ADMIN_SECRET → operatorId 'primary-admin' (super_admin).
    const isAdmin = verifyPassphrase(passphrase);
    const isViewer = !isAdmin && verifyViewerPassphrase(passphrase);

    if (isAdmin || isViewer) {
      const readOnly = isViewer;
      const operatorId = isViewer ? 'viewer' : 'primary-admin';
      const sessionId = await createSession(operatorId, readOnly);
      if (isAdmin) await bootstrapPrimaryAdmin();
      return new Response(JSON.stringify({ ok: true, readOnly }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeSessionCookie(sessionId) },
      });
    }

    // 2) Per-account admin login: username = email or handle (e.g. "admin"),
    //    passphrase = password. Covers both employees and the owner's personal
    //    login.
    if (username && username.trim()) {
      const account = await verifyAdminLogin(username, passphrase);
      if (account) {
        if (account.passwordResetRequired) {
          const resetToken = await createRequiredPasswordResetToken(account.id);
          return new Response(JSON.stringify({
            ok: false,
            passwordResetRequired: true,
            resetToken,
            message: 'Temporary password accepted. Create a new password to continue.',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // 'admin' / 'super_admin' accounts get full (non-read-only) sessions;
        // a 'viewer' account would be read-only. operatorId = account id so the
        // RBAC layer resolves their assigned role.
        const readOnly = account.role === 'viewer';
        const sessionId = await createSession(account.id, readOnly);
        return new Response(JSON.stringify({ ok: true, readOnly }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': makeSessionCookie(sessionId) },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
