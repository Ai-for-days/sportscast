import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { generateRankedSignals } from '../../../lib/signal-ranking';
import { withMetric } from '../../../lib/health-metrics';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { result: signals } = await withMetric('signal_generation', 'signals', () => generateRankedSignals());
    return new Response(JSON.stringify({ signals }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
