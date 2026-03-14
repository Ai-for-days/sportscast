import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getRecentSamples, getRouteStats, getPerformanceSummary, resetMetrics } from '../../../lib/performance-metrics';
import { listCacheEntries, getCacheStats, cacheInvalidate, cacheInvalidateAll } from '../../../lib/performance-cache';
import { logAuditEvent } from '../../../lib/audit-log';

/* ------------------------------------------------------------------ */
/*  GET                                                                */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'metrics') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const samples = getRecentSamples(limit);
      const stats = getRouteStats();
      return new Response(JSON.stringify({ samples, stats }), { status: 200 });
    }

    if (action === 'cache') {
      const entries = listCacheEntries();
      const stats = getCacheStats();
      return new Response(JSON.stringify({ entries, stats }), { status: 200 });
    }

    if (action === 'routes') {
      const stats = getRouteStats();
      return new Response(JSON.stringify({ routes: stats }), { status: 200 });
    }

    // Default: overview
    const perfSummary = getPerformanceSummary();
    const cacheStats = getCacheStats();
    const topRoutes = getRouteStats()
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, 10);
    const recentSamples = getRecentSamples(20);

    return new Response(JSON.stringify({
      performance: perfSummary,
      cache: cacheStats,
      topRoutes,
      recentSamples,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                               */
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
      case 'invalidate-cache': {
        const { key } = body;
        if (key) {
          const removed = cacheInvalidate(key);
          await logAuditEvent({ actor: 'admin', eventType: 'cache_invalidated', targetType: 'cache', targetId: key, summary: `Cache key invalidated: ${key}` });
          return new Response(JSON.stringify({ ok: true, removed }), { status: 200 });
        }
        const count = cacheInvalidateAll();
        await logAuditEvent({ actor: 'admin', eventType: 'cache_invalidated', targetType: 'cache', targetId: 'all', summary: `All cache keys invalidated (${count})` });
        return new Response(JSON.stringify({ ok: true, cleared: count }), { status: 200 });
      }

      case 'reset-metrics': {
        const result = resetMetrics();
        await logAuditEvent({ actor: 'admin', eventType: 'performance_metrics_reset', targetType: 'performance', targetId: 'all', summary: `Performance metrics reset (${result.cleared} entries)` });
        return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
