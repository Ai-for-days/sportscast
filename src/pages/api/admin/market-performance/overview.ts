import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildMarketPerformanceReport } from '../../../../lib/market-performance';

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const report = await buildMarketPerformanceReport();
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
