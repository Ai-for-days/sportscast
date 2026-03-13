import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { runBacktest, type BacktestConfig } from '../../../lib/backtesting';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();

    const config: BacktestConfig = {
      minEdge: body.minEdge ?? 0.03,
      confidenceFilter: body.confidenceFilter || undefined,
      sourceFilter: body.sourceFilter || undefined,
      sizingTierFilter: body.sizingTierFilter || undefined,
      maxTradeSizeCents: body.maxTradeSizeCents || undefined,
      dateFrom: body.dateFrom || undefined,
      dateTo: body.dateTo || undefined,
    };

    const result = await runBacktest(config);

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
