import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getSensitiveActionRegistry, getRegistrySummary } from '../../../../lib/sensitive-actions';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const actions = getSensitiveActionRegistry();
    const summary = getRegistrySummary();
    return new Response(JSON.stringify({
      actions,
      summary,
      auditCompletedAt: new Date().toISOString(),
      notes: [
        'Permission checks use the existing checkPermission() from security-store.ts which consults RBAC roles.',
        'If no user role record exists for an operator, checkPermission defaults to allowed (backward compatibility).',
        'Dual-control enforcement (self-approval blocking) is handled at the lib level (go-live.ts, security-store.ts).',
        'Execution guards (kill switch, canExecuteLive) are enforced via execution-config.ts helpers.',
        'To fully enforce per-user RBAC, operator userId must be passed from session — currently defaults to "admin".',
        'This is a targeted hardening pass, not a full RBAC integration. Full per-user enforcement is a recommended future step.',
      ],
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
