import type { APIRoute } from 'astro';
import { runHealthChecks, computeHealthOverview } from '../../../lib/execution-health';
import { logAuditEvent } from '../../../lib/audit-log';

export const GET: APIRoute = async () => {
  try {
    const checks = await runHealthChecks();
    const overview = computeHealthOverview(checks);

    return new Response(JSON.stringify({ checks, overview }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
