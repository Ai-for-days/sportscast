import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildStrategyComparisonReport, type ComparisonFilters } from '../../../../lib/strategy-comparison';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function parseFilters(url: URL): ComparisonFilters {
  const sp = url.searchParams;
  const out: ComparisonFilters = {};
  const dateFrom = sp.get('dateFrom');
  const dateTo   = sp.get('dateTo');
  const source   = sp.get('source');
  const metric   = sp.get('metric');
  const mode     = sp.get('mode') as ComparisonFilters['mode'] | null;
  const minSampleSize = sp.get('minSampleSize');
  if (dateFrom) out.dateFrom = dateFrom;
  if (dateTo)   out.dateTo = dateTo;
  if (source === 'kalshi' || source === 'sportsbook') out.source = source;
  if (metric)   out.metric = metric;
  if (mode === 'demo' || mode === 'live' || mode === 'all') out.mode = mode;
  if (minSampleSize) out.minSampleSize = parseInt(minSampleSize, 10) || undefined;
  return out;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const filters = parseFilters(url);
    const report = await withTiming(
      'strategy-comparison',
      'quant-review',
      () => cached(`strategy-comparison:${JSON.stringify(filters)}`, () => buildStrategyComparisonReport(filters), 30_000),
    );
    return jsonResponse(report);
  } catch (err: any) {
    return jsonResponse({ error: 'strategy_comparison_failed', message: err?.message ?? String(err) }, 500);
  }
};
