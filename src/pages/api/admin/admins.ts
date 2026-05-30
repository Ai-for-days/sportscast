// ── Admin API: Manage employee admin accounts (owner-only) ──────────────────
//
// Gated by the existing `manage_users_and_roles` permission, which only
// super_admin (the owner) holds. Employees (role 'admin') are blocked here —
// that is exactly the "everyone can do everything EXCEPT add admins" rule.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../lib/admin-auth';
import { requirePermission } from '../../../lib/sensitive-actions';
import {
  listAdminAccounts,
  createAdminAccount,
  setAdminAccountStatus,
  setAdminPassword,
} from '../../../lib/admin-account-store';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function gate(session: string, description: string) {
  return requirePermission(session, 'manage_users_and_roles', description);
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const action = url.searchParams.get('action') ?? 'list';
  if (action !== 'list') return json({ error: 'unknown_action' }, 400);

  const auth = await gate(session, 'list admin accounts');
  if (!auth.allowed) return json({ error: 'forbidden', reason: auth.reason }, 403);

  return json({ admins: await listAdminAccounts() });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const action = body?.action as string;

  const auth = await gate(session, `manage admin accounts: ${action}`);
  if (!auth.allowed) return json({ error: 'forbidden', reason: auth.reason }, 403);

  const actor = await getOperatorId(session);

  if (action === 'create') {
    const result = await createAdminAccount({
      email: String(body.email ?? ''),
      displayName: String(body.displayName ?? ''),
      password: String(body.password ?? ''),
      // UI only offers full-employee admins for now; default 'admin'.
      role: body.role === 'super_admin' ? 'super_admin' : 'admin',
      createdBy: actor,
    });
    if (!result.ok) return json({ error: result.error }, 400);
    return json({ ok: true, account: result.account });
  }

  if (action === 'set-status') {
    const id = String(body.id ?? '');
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (id === actor || id === 'primary-admin') {
      return json({ error: 'You cannot disable your own / the owner account.' }, 400);
    }
    const account = await setAdminAccountStatus(id, status, actor);
    if (!account) return json({ error: 'not_found' }, 404);
    return json({ ok: true, account });
  }

  if (action === 'reset-password') {
    const id = String(body.id ?? '');
    const result = await setAdminPassword(id, String(body.password ?? ''), actor);
    if (!result.ok) return json({ error: result.error }, 400);
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
};
