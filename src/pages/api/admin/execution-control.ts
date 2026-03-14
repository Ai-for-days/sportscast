import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getExecutionConfig, updateExecutionConfig } from '../../../lib/execution-config';
import { HARD_LIMITS } from '../../../lib/pretrade-risk';
import { listAuditEvents, logAuditEvent } from '../../../lib/audit-log';
import { requirePermission } from '../../../lib/sensitive-actions';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [config, auditEvents] = await Promise.all([
      getExecutionConfig(),
      listAuditEvents(30),
    ]);

    return new Response(JSON.stringify({ config, hardLimits: HARD_LIMITS, auditEvents }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'update-config') {
      const permCheck = await requirePermission(session, 'toggle_kill_switch', 'execution config update');
      if (!permCheck.allowed) {
        return new Response(JSON.stringify({ error: permCheck.reason, code: permCheck.code }), { status: 403 });
      }

      const prev = await getExecutionConfig();
      const config = await updateExecutionConfig(body.updates || {});

      // Audit log for changes
      const changes: string[] = [];
      if (prev.mode !== config.mode) changes.push(`mode: ${prev.mode} → ${config.mode}`);
      if (prev.killSwitchEnabled !== config.killSwitchEnabled) changes.push(`kill switch: ${config.killSwitchEnabled ? 'ON' : 'OFF'}`);
      if (prev.requireApproval !== config.requireApproval) changes.push(`approval required: ${config.requireApproval}`);
      if (prev.liveTradingEnabled !== config.liveTradingEnabled) changes.push(`live trading: ${config.liveTradingEnabled}`);
      if (prev.demoTradingEnabled !== config.demoTradingEnabled) changes.push(`demo trading: ${config.demoTradingEnabled}`);

      if (changes.length > 0) {
        await logAuditEvent({
          actor: 'admin',
          eventType: 'config_changed',
          targetType: 'execution-config',
          summary: `Execution config updated: ${changes.join(', ')}`,
          details: { previous: prev, current: config },
        });
      }

      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'toggle-kill-switch') {
      const permCheck = await requirePermission(session, 'toggle_kill_switch', 'kill switch toggle');
      if (!permCheck.allowed) {
        return new Response(JSON.stringify({ error: permCheck.reason, code: permCheck.code }), { status: 403 });
      }

      const prev = await getExecutionConfig();
      const config = await updateExecutionConfig({ killSwitchEnabled: !prev.killSwitchEnabled });

      await logAuditEvent({
        actor: 'admin',
        eventType: 'kill_switch_toggled',
        targetType: 'execution-config',
        summary: `Kill switch ${config.killSwitchEnabled ? 'ACTIVATED' : 'DEACTIVATED'}`,
      });

      return new Response(JSON.stringify({ config }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
