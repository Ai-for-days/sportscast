import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildStressTestReport } from '../../../../lib/allocation-stress-test';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function parseSims(url: URL): number {
  const raw = url.searchParams.get('simulations');
  const n = raw ? parseInt(raw, 10) : 1000;
  if (Number.isNaN(n)) return 1000;
  return Math.max(50, Math.min(n, 10_000));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const simulations = parseSims(url);
    const cacheKey = `allocation-stress-test:${simulations}`;
    const report = await withTiming(
      'allocation-stress-test',
      'quant-review',
      () => cached(cacheKey, () => buildStressTestReport({ simulations }), 30_000),
    );
    return jsonResponse(report);
  } catch (err: any) {
    return jsonResponse({ error: 'stress_test_failed', message: err?.message ?? String(err) }, 500);
  }
};
