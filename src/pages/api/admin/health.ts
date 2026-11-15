import type { APIRoute } from 'astro';
import { runHealthChecks, computeHealthOverview } from '../../../lib/execution-health';
import { logAuditEvent } from '../../../lib/audit-log';
import { requireAdmin } from '../../../lib/admin-auth';

// Admin only (WOW-026): this returned internal pipeline state to anyone.
export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const checks = await runHealthChecks();
    const overview = computeHealthOverview(checks);

    return new Response(JSON.stringify({ checks, overview }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
