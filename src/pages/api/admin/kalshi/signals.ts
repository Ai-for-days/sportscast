import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { generateAllSignals } from '../../../../lib/kalshi-signals';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const signals = await generateAllSignals();

    const mappedCount = signals.filter(s => s.mapped).length;
    const unmappedCount = signals.filter(s => !s.mapped).length;
    const withEdge = signals.filter(s => s.recommendedSide !== 'none').length;

    return new Response(JSON.stringify({ signals, mappedCount, unmappedCount, withEdge }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
