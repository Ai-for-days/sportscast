import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildScorecard } from '../../../../lib/strategy-scorecard';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const scorecard = await withTiming(
      'strategy-scorecard:build',
      'quant-review',
      () => cached('strategy-scorecard:v1', () => buildScorecard(), 30_000),
    );
    return jsonResponse({ scorecard });
  } catch (err: any) {
    return jsonResponse({ error: 'strategy_scorecard_failed', message: err?.message ?? String(err) }, 500);
  }
};
