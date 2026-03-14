import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import {
  getHealthSummary, computeSubsystemHealth, listMetricEvents,
  getSubsystemDefinitions, SUBSYSTEM_LABELS, recordMetric,
} from '../../../../lib/health-metrics';
import { cached } from '../../../../lib/performance-cache';
import { withTiming } from '../../../../lib/performance-metrics';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'events') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const events = await listMetricEvents(limit);
      return new Response(JSON.stringify({ events }), { status: 200 });
    }

    // Overview
    const { result: summary, durationMs } = await withTiming(
      '/api/admin/system/health?overview', 'system-health',
      () => cached('health:overview', async () => {
        const [health, defs] = await Promise.all([
          getHealthSummary(),
          getSubsystemDefinitions(),
        ]);
        return { ...health, definitions: defs, subsystemLabels: SUBSYSTEM_LABELS };
      }, 15_000),
    );

    return new Response(JSON.stringify({ ...summary, _meta: { durationMs } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
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

    if (action === 'record-metric') {
      const { operation, subsystem, durationMs, status, metadata } = body;
      if (!operation || !subsystem || durationMs == null) {
        return new Response(JSON.stringify({ error: 'operation, subsystem, durationMs required' }), { status: 400 });
      }
      const event = await recordMetric(operation, subsystem, durationMs, status || 'success', metadata);
      return new Response(JSON.stringify({ ok: true, event }), { status: 200 });
    }

    if (action === 'run-redis-check') {
      // Quick Redis latency check and record it
      const start = Date.now();
      const { getRedis } = await import('../../../../lib/redis');
      const redis = getRedis();
      await redis.ping();
      const dur = Date.now() - start;
      const event = await recordMetric('redis_query', 'system', dur, 'success', { type: 'ping' });
      return new Response(JSON.stringify({ ok: true, event, latencyMs: dur }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
