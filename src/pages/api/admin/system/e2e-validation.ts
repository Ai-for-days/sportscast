import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getOperatorId } from '../../../../lib/admin-auth';
import {
  runAllE2EChecks, runStageChecks, saveE2EBatch, listE2ERuns,
  getE2ECheckDefinitions, getManualItems, getAllManualSignoffs,
  confirmManualSignoff, STAGE_LABELS, STAGES,
} from '../../../../lib/e2e-validation';
import { logAuditEvent } from '../../../../lib/audit-log';
import { cached } from '../../../../lib/performance-cache';
import { withTiming } from '../../../../lib/performance-metrics';

export const prerender = false;

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'history') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const { result: runs, durationMs } = await withTiming(
        '/api/admin/system/e2e-validation?history', 'e2e-validation',
        () => listE2ERuns(limit),
      );
      return new Response(JSON.stringify({ runs, _meta: { count: runs.length, limit, durationMs } }), { status: 200 });
    }

    // Default: overview
    const { result: overview, durationMs } = await withTiming(
      '/api/admin/system/e2e-validation?overview', 'e2e-validation',
      () => cached('e2e:overview', async () => {
        const [checks, manualItems, signoffs, history] = await Promise.all([
          getE2ECheckDefinitions(),
          getManualItems(),
          getAllManualSignoffs(),
          listE2ERuns(20),
        ]);
        return { checks, manualItems, signoffs, stageLabels: STAGE_LABELS, stages: STAGES, recentHistory: history };
      }, 30_000),
    );

    return new Response(JSON.stringify({ ...overview, _meta: { durationMs } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;
    const operatorId = await getOperatorId(session);

    switch (action) {
      case 'run-all': {
        const checks = await runAllE2EChecks();
        const runs = await saveE2EBatch(checks, operatorId);
        await logAuditEvent({
          actor: operatorId,
          eventType: 'e2e_validation_run_all',
          targetType: 'e2e-validation',
          targetId: 'all',
          summary: `Ran all ${checks.length} E2E checks — ${checks.filter(c => c.status === 'pass').length} pass, ${checks.filter(c => c.status === 'fail').length} fail, ${checks.filter(c => c.status === 'warn').length} warn`,
        });
        return new Response(JSON.stringify({ ok: true, checks, runs }), { status: 200 });
      }

      case 'run-stage': {
        const stage = body.stage;
        if (!STAGES.includes(stage)) {
          return new Response(JSON.stringify({ error: `Invalid stage: ${stage}` }), { status: 400 });
        }
        const checks = await runStageChecks(stage);
        const runs = await saveE2EBatch(checks, operatorId);
        return new Response(JSON.stringify({ ok: true, checks, runs }), { status: 200 });
      }

      case 'manual-signoff': {
        const { key, notes } = body;
        if (!key) return new Response(JSON.stringify({ error: 'key required' }), { status: 400 });
        const signoff = await confirmManualSignoff(key, operatorId, notes);
        if (!signoff) return new Response(JSON.stringify({ error: `Unknown manual item: ${key}` }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, signoff }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
