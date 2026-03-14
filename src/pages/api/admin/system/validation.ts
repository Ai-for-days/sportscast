import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import {
  runAllChecks, runCategoryChecks, runSingleCheck,
  saveValidationBatch, listValidationRuns, getCheckDefinitions,
} from '../../../../lib/validation';
import { logAuditEvent } from '../../../../lib/audit-log';
import { cached } from '../../../../lib/performance-cache';
import { withTiming } from '../../../../lib/performance-metrics';
import { withMetric } from '../../../../lib/health-metrics';

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

    if (action === 'definitions') {
      const defs = getCheckDefinitions();
      return new Response(JSON.stringify({ definitions: defs }), { status: 200 });
    }

    if (action === 'history') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const { result: runs, durationMs } = await withTiming(
        '/api/admin/system/validation?history', 'validation',
        () => listValidationRuns(limit),
      );
      return new Response(JSON.stringify({ runs, _meta: { count: runs.length, limit, durationMs } }), { status: 200 });
    }

    // Default: overview (cached)
    const { result: overview, durationMs } = await withTiming(
      '/api/admin/system/validation?overview', 'validation',
      () => cached('validation:overview', async () => {
        const [defs, history] = await Promise.all([
          getCheckDefinitions(),
          listValidationRuns(20),
        ]);
        return { definitions: defs, recentHistory: history };
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

    switch (action) {
      case 'run-all': {
        const { result: checks } = await withMetric('validation_scan', 'system', () => runAllChecks());
        const runs = await saveValidationBatch(checks);
        await logAuditEvent({
          actor: 'admin',
          eventType: 'validation_run_all',
          targetType: 'validation',
          targetId: 'all',
          summary: `Ran all ${checks.length} validation checks — ${checks.filter(c => c.status === 'pass').length} pass, ${checks.filter(c => c.status === 'fail').length} fail, ${checks.filter(c => c.status === 'warn').length} warn`,
        });
        return new Response(JSON.stringify({ ok: true, checks, runs }), { status: 200 });
      }

      case 'run-category': {
        const category = body.category;
        if (!['engineering', 'trading', 'operator', 'launch'].includes(category)) {
          return new Response(JSON.stringify({ error: `Invalid category: ${category}` }), { status: 400 });
        }
        const checks = await runCategoryChecks(category);
        const runs = await saveValidationBatch(checks);
        await logAuditEvent({
          actor: 'admin',
          eventType: 'validation_run_category',
          targetType: 'validation',
          targetId: category,
          summary: `Ran ${category} checks — ${checks.filter(c => c.status === 'pass').length} pass, ${checks.filter(c => c.status === 'fail').length} fail`,
        });
        return new Response(JSON.stringify({ ok: true, checks, runs }), { status: 200 });
      }

      case 'run-check': {
        const key = body.key;
        if (!key) return new Response(JSON.stringify({ error: 'key required' }), { status: 400 });
        const check = await runSingleCheck(key);
        if (!check) return new Response(JSON.stringify({ error: `Unknown check: ${key}` }), { status: 404 });
        const runs = await saveValidationBatch([check]);
        return new Response(JSON.stringify({ ok: true, check, run: runs[0] }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
