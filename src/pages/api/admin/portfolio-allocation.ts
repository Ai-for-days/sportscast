import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { buildAllocationReport } from '../../../lib/portfolio-allocation';
import { withTiming } from '../../../lib/performance-metrics';
import { cached } from '../../../lib/performance-cache';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const report = await withTiming(
      'portfolio-allocation',
      'quant-review',
      () => cached('portfolio-allocation:report', () => buildAllocationReport(), 30_000),
    );
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};
