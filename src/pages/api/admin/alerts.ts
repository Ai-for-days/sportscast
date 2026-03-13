import type { APIRoute } from 'astro';
import {
  listAlerts,
  generateAlerts,
  acknowledgeAlert,
  resolveAlert,
  clearResolved,
  getAlertSummary,
} from '../../../lib/alerts';
import { runHealthChecks, computeHealthOverview } from '../../../lib/execution-health';
import { logAuditEvent } from '../../../lib/audit-log';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async () => {
  try {
    const [alerts, summary, checks] = await Promise.all([
      listAlerts(100),
      getAlertSummary(),
      runHealthChecks(),
    ]);
    const healthOverview = computeHealthOverview(checks);

    return new Response(JSON.stringify({
      alerts,
      summary,
      healthChecks: checks,
      healthOverview,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'run-health-checks': {
        const checks = await runHealthChecks();
        const overview = computeHealthOverview(checks);
        const generated = await generateAlerts();
        await logAuditEvent({
          actor: 'admin',
          eventType: 'health_checks_run',
          targetType: 'system',
          targetId: 'health',
          summary: `Health checks run: ${overview.healthy} healthy, ${overview.warning} warning, ${overview.critical} critical. ${generated.length} alerts generated.`,
        });
        return new Response(JSON.stringify({ ok: true, checks, overview, alertsGenerated: generated.length }), { status: 200 });
      }

      case 'acknowledge-alert': {
        const { id } = body;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
        const alert = await acknowledgeAlert(id);
        if (!alert) return new Response(JSON.stringify({ error: 'Alert not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, alert }), { status: 200 });
      }

      case 'resolve-alert': {
        const { id } = body;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
        const alert = await resolveAlert(id);
        if (!alert) return new Response(JSON.stringify({ error: 'Alert not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, alert }), { status: 200 });
      }

      case 'clear-resolved': {
        const count = await clearResolved();
        return new Response(JSON.stringify({ ok: true, cleared: count }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
