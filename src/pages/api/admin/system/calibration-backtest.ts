import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildCalibrationBacktestReport, type BacktestFilters } from '../../../../lib/calibration-backtest';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function parseFilters(url: URL): BacktestFilters {
  const sp = url.searchParams;
  const filters: BacktestFilters = {};
  const dateFrom = sp.get('dateFrom');
  const dateTo = sp.get('dateTo');
  const source = sp.get('source');
  const metric = sp.get('metric');
  const location = sp.get('location');
  const minSampleSize = sp.get('minSampleSize');
  const mode = sp.get('mode') as BacktestFilters['mode'] | null;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;
  if (source) filters.source = source;
  if (metric) filters.metric = metric;
  if (location) filters.location = location;
  if (minSampleSize) filters.minSampleSize = parseInt(minSampleSize, 10) || undefined;
  if (mode === 'demo' || mode === 'live' || mode === 'all') filters.mode = mode;
  return filters;
}

function cacheKey(filters: BacktestFilters): string {
  return `calibration-backtest:${JSON.stringify(filters)}`;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const filters = parseFilters(url);
    const report = await withTiming(
      'calibration-backtest',
      'quant-review',
      () => cached(cacheKey(filters), () => buildCalibrationBacktestReport(filters), 30_000),
    );
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as string | undefined;
    if (action === 'refresh') {
      const filters = (body.filters ?? {}) as BacktestFilters;
      const report = await buildCalibrationBacktestReport(filters);
      return new Response(JSON.stringify(report), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};
