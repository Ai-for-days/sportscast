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
      failClosedEnforcement: {
        realSessionIdentity: true,
        failClosedOnMissingRBAC: true,
        sessionField: 'sessionId from requireAdmin() (32-char cookie value)',
        description: 'Step 54A hardened sensitive-action checks to fail closed. Missing RBAC records deny access. Real session identity is used (not hardcoded "admin").',
      },
      legacyCompatibility: {
        description: 'The legacy checkPermission() in security-store.ts still defaults to allowed when no user record exists. This is used by non-sensitive read paths. Sensitive actions bypass this via the fail-closed requirePermission() in sensitive-actions.ts.',
        affectedPaths: 'Non-sensitive admin reads (listing forecasts, viewing dashboards, etc.)',
        recommendation: 'Future step: assign RBAC roles to all admin sessions via /admin/security, then switch legacy checkPermission to fail-closed globally.',
      },
      notes: [
        'FAIL-CLOSED: Sensitive action permission checks deny by default when no RBAC user record exists.',
        'REAL IDENTITY: Session ID from requireAdmin() is used as operator identity — no more hardcoded "admin".',
        'To use sensitive actions, the operator session must have an RBAC role assigned via /admin/security.',
        'Dual-control enforcement (self-approval blocking) is handled at the lib level (go-live.ts, security-store.ts).',
        'Execution guards (kill switch, canExecuteLive) are enforced via execution-config.ts helpers.',
        'Legacy compatibility: non-sensitive reads still use the permissive checkPermission() default for backward compat.',
        'Recommended next step: assign RBAC roles to admin sessions, then deprecate the legacy permissive default.',
      ],
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
