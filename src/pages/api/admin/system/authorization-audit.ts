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
        mode: 'single-operator',
        source: 'Server-controlled operator identity — all sessions bind to "primary-admin"',
        operatorIdField: '"primary-admin" — fixed, server-assigned, not client-choosable',
        rbacSubject: 'RBAC lookups use operatorId ("primary-admin"), not raw sessionId',
        clientSuppliedIdentity: false,
        description: 'Step 55A hardened identity binding. The login endpoint no longer accepts client-supplied operatorId. All authenticated sessions map to the server-controlled identity "primary-admin". This is honest about the single-passphrase auth model.',
      },
      bootstrap: {
        mechanism: 'Auto-seed on login',
        description: 'On first successful login, if no RBAC record exists for "primary-admin", the system auto-creates one with role "super_admin". This is a one-time bootstrap — subsequent logins are no-ops.',
        guardedBy: 'Passphrase authentication (ADMIN_SECRET)',
        permanent: false,
        notes: 'Bootstrap only fires when no "primary-admin" RBAC record exists. Once seeded, the record persists and is managed normally via /admin/security.',
      },
      failClosedEnforcement: {
        realOperatorIdentity: true,
        serverControlledIdentity: true,
        failClosedOnMissingRBAC: true,
        failClosedOnMissingOperator: true,
        description: 'Sensitive actions resolve operatorId from session (server-assigned), then check RBAC by operatorId. Missing RBAC records deny. Missing operator identity denies.',
      },
      legacyCompatibility: {
        description: 'The legacy checkPermission() in security-store.ts still defaults to allowed when no user record exists. This is only used by non-sensitive read paths. Sensitive actions use the fail-closed requirePermission().',
        sessionMigration: 'Legacy sessions without operatorId field default to "primary-admin" at read time. No data migration needed.',
        affectedPaths: 'Non-sensitive admin reads (listing forecasts, viewing dashboards, etc.)',
      },
      notes: [
        'SINGLE-OPERATOR MODE: Platform operates as a single-operator system. All sessions bind to "primary-admin".',
        'SERVER-CONTROLLED: Operator identity is assigned server-side at login — not client-choosable.',
        'SPOOFING FIXED: Login no longer accepts client-supplied operatorId (Step 55A).',
        'AUTO-BOOTSTRAP: First login auto-seeds "primary-admin" with super_admin role if no RBAC record exists.',
        'FAIL-CLOSED: Missing operator identity or missing RBAC record → denied for sensitive actions.',
        'RBAC SUBJECT: All RBAC lookups for sensitive actions use "primary-admin" as the subject.',
        'Dual-control enforcement (self-approval blocking) handled at lib level (go-live.ts, security-store.ts).',
        'Execution guards (kill switch, canExecuteLive) enforced via execution-config.ts helpers.',
        'Legacy compatibility: non-sensitive reads still use permissive checkPermission() default.',
        'FUTURE: Multi-operator support would require per-operator authentication (e.g., individual credentials), not just a shared passphrase.',
      ],
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
