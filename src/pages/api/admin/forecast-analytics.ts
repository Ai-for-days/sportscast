// Aggregates for /admin/forecast-performance.
//
// Reads the Forecast Tracker's scored entries and returns everything the
// dashboard draws in ONE response: facet options, totals, the previous-period
// comparison, the time series, and the selected dimension breakdown. One
// round trip per filter change keeps the chart and the table from ever
// disagreeing about what the filters currently are.
//
// All the arithmetic lives in forecast-analytics.ts and is unit-tested; this
// route is loading, parsing and caching only.

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { listForecastEntries } from '../../../lib/forecast-tracker-store';
import {
  toRows, filterRows, totals, unitFor, seriesByDate, byDimension, facetOptions,
  previousPeriod, deltaOf, autoGranularity, valueOf, METRICS, DIMENSION_LABELS,
  type AnalyticsRow, type MetricKey, type DimensionKey, type Granularity, type Filters,
} from '../../../lib/forecast-analytics';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// ── Cache ───────────────────────────────────────────────────────────────────
//
// The full history is a few thousand entries fetched in 256-key pipelines, and
// an operator moving filters fires a request per click. Entries only change
// when someone logs a forecast or the verify cron settles one, so a short memo
// turns a burst of filter changes into one read. Module scope, so a cold
// lambda simply repopulates it.
const TTL_MS = 60_000;
let cache: { rows: AnalyticsRow[]; at: number } | null = null;

async function loadRows(): Promise<{ rows: AnalyticsRow[]; cached: boolean }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { rows: cache.rows, cached: true };
  const entries = await listForecastEntries();
  const rows = toRows(entries);
  cache = { rows, at: Date.now() };
  return { rows, cached: false };
}

/** `?sources=a,b` -> ['a','b']; absent or empty -> undefined (meaning "all"). */
function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

function isMetricKey(v: string | null): v is MetricKey {
  return !!v && Object.prototype.hasOwnProperty.call(METRICS, v);
}
function isDimension(v: string | null): v is DimensionKey {
  return !!v && Object.prototype.hasOwnProperty.call(DIMENSION_LABELS, v);
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  try {
    const { rows, cached } = await loadRows();
    // Facets describe the WHOLE dataset, not the filtered slice: a filter
    // control that drops its own options as you use it is a trap.
    const facets = facetOptions(rows);

    const from = url.searchParams.get('from') || facets.minDate;
    const to = url.searchParams.get('to') || facets.maxDate;
    const metric: MetricKey = isMetricKey(url.searchParams.get('metric'))
      ? (url.searchParams.get('metric') as MetricKey) : 'mae';
    const dimension: DimensionKey = isDimension(url.searchParams.get('dimension'))
      ? (url.searchParams.get('dimension') as DimensionKey) : 'source';
    const gParam = url.searchParams.get('granularity');
    const granularity: Granularity = gParam === 'day' || gParam === 'week' ? gParam : autoGranularity(from, to);

    const filters: Filters = {
      from, to,
      sources: csv(url.searchParams.get('sources')),
      metrics: csv(url.searchParams.get('metrics')),
      locations: csv(url.searchParams.get('locations')),
      leadBuckets: csv(url.searchParams.get('leadBuckets')),
    };

    const current = filterRows(rows, filters);
    const prevRange = previousPeriod({ from, to });
    const previous = filterRows(rows, { ...filters, from: prevRange.from, to: prevRange.to });

    const curTotals = totals(current);
    const prevTotals = totals(previous);

    // Series are split by source, which is the comparison this page exists for.
    // When the operator has filtered to one source there is nothing to compare,
    // so the split collapses and the single line is that source.
    const seriesKeys = filters.sources && filters.sources.length > 0
      ? filters.sources
      : facets.sources;

    const deltas: Record<string, ReturnType<typeof deltaOf>> = {};
    for (const k of Object.keys(METRICS) as MetricKey[]) {
      deltas[k] = deltaOf(valueOf(curTotals, k), valueOf(prevTotals, k), k);
    }

    return json({
      facets,
      range: { from, to, granularity, previous: prevRange },
      unit: unitFor(current),
      totals: curTotals,
      previousTotals: prevTotals,
      deltas,
      metric,
      dimension,
      seriesKeys,
      series: seriesByDate(current, metric, granularity, seriesKeys),
      dimensionRows: byDimension(current, dimension),
      cached,
    });
  } catch (err: any) {
    console.error('[forecast-analytics]', err);
    return json({ error: err?.message ?? 'Failed to build forecast analytics' }, 500);
  }
};
