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
      identityModel: {
        source: 'Stable operator identity resolved from session via getOperatorId()',
        sessionField: 'sessionId from requireAdmin() → resolves to operatorId stored in session record',
        operatorIdField: 'operatorId (e.g., "primary-admin") — stable across session rotations',
        rbacSubject: 'RBAC lookups use operatorId, not raw sessionId',
        defaultOperator: 'primary-admin (single-passphrase system default)',
        description: 'Step 55 introduced stable operator identity. Sessions now store an operatorId. RBAC records are keyed by operatorId. Legacy sessions without operatorId default to "primary-admin".',
      },
      failClosedEnforcement: {
        realOperatorIdentity: true,
        failClosedOnMissingRBAC: true,
        failClosedOnMissingOperator: true,
        description: 'Sensitive actions resolve operatorId from session, then check RBAC by operatorId. Missing RBAC records deny. Missing operator identity denies.',
      },
      legacyCompatibility: {
        description: 'The legacy checkPermission() in security-store.ts still defaults to allowed when no user record exists. This is only used by non-sensitive read paths. Sensitive actions use the fail-closed requirePermission() which resolves operator identity from session.',
        sessionMigration: 'Legacy sessions (pre-Step 55) that lack an operatorId field default to "primary-admin". No data migration needed — handled at read time.',
        affectedPaths: 'Non-sensitive admin reads (listing forecasts, viewing dashboards, etc.)',
        recommendation: 'Assign RBAC role to "primary-admin" via /admin/security to enable sensitive actions.',
      },
      notes: [
        'STABLE IDENTITY: Sensitive actions now use operatorId (e.g., "primary-admin") resolved from session — not raw sessionId.',
        'FAIL-CLOSED: Missing operator identity or missing RBAC record → denied.',
        'RBAC SUBJECT: RBAC records should be keyed by operatorId (e.g., assign role to userId "primary-admin" in /admin/security).',
        'SESSION STORAGE: Sessions now store { createdAt, operatorId }. Legacy sessions default operatorId to "primary-admin".',
        'LOGIN SUPPORT: Login endpoint accepts optional operatorId field for future multi-operator support.',
        'Dual-control enforcement (self-approval blocking) handled at lib level (go-live.ts, security-store.ts).',
        'Execution guards (kill switch, canExecuteLive) enforced via execution-config.ts helpers.',
        'Legacy compatibility: non-sensitive reads still use permissive checkPermission() default.',
        'Recommended next step: assign "super_admin" role to "primary-admin" via /admin/security to activate sensitive action authorization.',
      ],
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
