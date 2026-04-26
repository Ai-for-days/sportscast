import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { buildEdgeValidationReport, type EdgeValidationFilters } from '../../../lib/edge-validation';
import { withTiming } from '../../../lib/performance-metrics';
import { cached } from '../../../lib/performance-cache';

export const prerender = false;

function parseFilters(url: URL): EdgeValidationFilters {
  const sp = url.searchParams;
  const out: EdgeValidationFilters = {};
  const dateFrom = sp.get('dateFrom');
  const dateTo   = sp.get('dateTo');
  const source   = sp.get('source');
  const metric   = sp.get('metric');
  const location = sp.get('location');
  const mode     = sp.get('mode') as EdgeValidationFilters['mode'] | null;
  if (dateFrom) out.dateFrom = dateFrom;
  if (dateTo)   out.dateTo = dateTo;
  if (source === 'kalshi' || source === 'sportsbook') out.source = source;
  if (metric)   out.metric = metric;
  if (location) out.location = location;
  if (mode === 'demo' || mode === 'live' || mode === 'all') out.mode = mode;
  return out;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const filters = parseFilters(url);
    const report = await withTiming(
      'edge-validation',
      'quant-review',
      () => cached(`edge-validation:${JSON.stringify(filters)}`, () => buildEdgeValidationReport(filters), 30_000),
    );
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message ?? 'unknown' }), { status: 500 });
  }
};
