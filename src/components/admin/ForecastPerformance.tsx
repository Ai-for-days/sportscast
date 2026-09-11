// Forecast Performance — the Search-Console-shaped read of the Forecast Tracker.
//
// The tracker at /admin/forecasts has been logging every source's forecast
// against the observation that settled it since 2026-03. This page answers the
// question that data was collected to answer: is our forecast better than
// theirs, and where is it worse?
//
// Shape borrowed from Search Console: clickable metric tiles over one time
// series, a filter row, and dimension tabs with a table underneath.
//
// ── Two deliberate departures from Search Console ───────────────────────────
//
// 1. ONE METRIC ON THE CHART AT A TIME. Search Console plots clicks,
//    impressions, CTR and position together on stacked hidden axes, which
//    invents visual correlations between series whose scales have nothing to do
//    with each other. Here the tiles SELECT the charted metric instead of
//    adding to it, and the lines are the SOURCES, which share one scale and are
//    the actual comparison.
//
// 2. THE SERIES ARE THE COMPARISON, NOT THE TOTAL. A single "how accurate were
//    we" line would hide the only thing that matters, which is the gap between
//    us and NWS on the same days.

import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { useChartTheme } from '../forecast/useChartTheme';

// ── Palette ─────────────────────────────────────────────────────────────────
//
// Validated with the data-viz skill's checker in BOTH modes before use:
// light passes lightness/chroma/CVD/normal-vision (worst adjacent CVD ΔE 9.1)
// with a contrast WARN that the table view below discharges; dark passes every
// check including contrast on the admin card surface.
//
// Assignment is BY SOURCE NAME, fixed. Colour follows the entity, so filtering
// to three sources leaves the survivors exactly the colour they already were.
const SOURCE_ORDER = ['wageronweather-consensus', 'nws', 'accuweather', 'weather.com', 'wageronweather'];
const LIGHT_SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const DARK_SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_LIGHT = '#6b7280';
const OTHER_DARK = '#9ca3af';

function colorFor(source: string, known: string[], dark: boolean): string {
  const slots = dark ? DARK_SLOTS : LIGHT_SLOTS;
  const ordered = [...SOURCE_ORDER, ...known.filter((s) => !SOURCE_ORDER.includes(s)).sort()];
  const i = ordered.indexOf(source);
  // Past the eighth hue a generated colour is indistinguishable under CVD, so
  // anything beyond the palette shares one neutral rather than inventing hues.
  if (i < 0 || i >= slots.length) return dark ? OTHER_DARK : OTHER_LIGHT;
  return slots[i];
}

const SOURCE_LABELS: Record<string, string> = {
  'wageronweather-consensus': 'Wager on Weather',
  'wageronweather': 'Open-Meteo (raw)',
  'nws': 'NWS',
  'accuweather': 'AccuWeather',
  'weather.com': 'Weather.com',
};
const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;

const METRIC_LABELS: Record<string, string> = {
  high_temp: 'High temp', low_temp: 'Low temp', actual_temp: 'Temp at time',
  wind_speed: 'Wind speed', wind_gust: 'Wind gust',
};
const metricLabel = (m: string) => METRIC_LABELS[m] ?? m;

// ── Types mirroring the API response ────────────────────────────────────────

type MetricKey = 'accuracy' | 'mae' | 'bias' | 'count';
type DimensionKey = 'source' | 'metric' | 'location' | 'leadBucket';

interface Totals { forecasts: number; verified: number; accuracy: number | null; mae: number | null; bias: number | null; }
interface Delta { absolute: number | null; percent: number | null; direction: 'better' | 'worse' | 'flat'; }
interface DimRow extends Totals { key: string }
interface Facets { sources: string[]; metrics: string[]; locations: string[]; leadBuckets: string[]; minDate: string; maxDate: string }
interface ApiResponse {
  facets: Facets;
  range: { from: string; to: string; granularity: 'day' | 'week'; previous: { from: string; to: string } };
  unit: string;
  totals: Totals;
  previousTotals: Totals;
  deltas: Record<MetricKey, Delta>;
  seriesKeys: string[];
  series: Record<string, string | number | null>[];
  dimensionRows: DimRow[];
  error?: string;
}

const TILES: { key: MetricKey; label: string; help: string }[] = [
  { key: 'mae', label: 'Mean abs error', help: 'Average miss, ignoring direction. Lower is better.' },
  { key: 'accuracy', label: 'Accuracy score', help: '0-100, difficulty-adjusted. The only measure comparable across temperature and wind.' },
  { key: 'bias', label: 'Bias', help: 'Average signed miss. Positive means forecasting too warm or too fast.' },
  { key: 'count', label: 'Forecasts', help: 'Verified forecasts in this selection.' },
];

const DIMENSIONS: { key: DimensionKey; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'metric', label: 'Metric' },
  { key: 'location', label: 'Location' },
  { key: 'leadBucket', label: 'Lead time' },
];

const RANGES = [
  { key: '28', label: 'Last 28 days', days: 28 },
  { key: '90', label: 'Last 3 months', days: 90 },
  { key: '180', label: 'Last 6 months', days: 180 },
  { key: 'all', label: 'All time', days: 0 },
];

function shiftDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  return new Date(ms + days * 86400000).toISOString().slice(0, 10);
}

function fmt(v: number | null, metric: MetricKey): string {
  if (v == null) return '—';
  if (metric === 'count') return v.toLocaleString();
  if (metric === 'accuracy') return v.toFixed(1);
  return v.toFixed(2);
}

/** MM-DD-YYYY, the site-wide convention (see src/lib/date-format.ts). */
function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${m}-${d}-${y}` : iso;
}

export default function ForecastPerformance() {
  const theme = useChartTheme();
  const dark = theme.mode === 'dark';

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [metric, setMetric] = useState<MetricKey>('mae');
  const [dimension, setDimension] = useState<DimensionKey>('source');
  const [rangeKey, setRangeKey] = useState('90');
  const [sources, setSources] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [leadBucket, setLeadBucket] = useState('');
  const [granularity, setGranularity] = useState<'auto' | 'day' | 'week'>('auto');

  // The data's own last day anchors the ranges, so a preset always lands on
  // data even when the newest entries are forecasts for days not yet played.
  const maxDate = data?.facets.maxDate ?? '';
  const minDate = data?.facets.minDate ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ metric, dimension });
    if (maxDate) {
      const r = RANGES.find((x) => x.key === rangeKey);
      const from = !r || r.days === 0 ? minDate : shiftDays(maxDate, -(r.days - 1));
      if (from) params.set('from', from);
      params.set('to', maxDate);
    }
    if (sources.length) params.set('sources', sources.join(','));
    if (metrics.length) params.set('metrics', metrics.join(','));
    if (location) params.set('locations', location);
    if (leadBucket) params.set('leadBuckets', leadBucket);
    if (granularity !== 'auto') params.set('granularity', granularity);

    fetch(`/api/admin/forecast-analytics?${params}`)
      .then((r) => r.json())
      .then((j: ApiResponse) => {
        if (cancelled) return;
        if (j.error) { setError(j.error); return; }
        setError(null);
        setData(j);
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [metric, dimension, rangeKey, sources, metrics, location, leadBucket, granularity, maxDate, minDate]);

  const seriesKeys = data?.seriesKeys ?? [];
  const knownSources = data?.facets.sources ?? [];

  // Every hook must run before any early return: a hook under a conditional
  // return is React error #310, which blanked six admin pages in f191c48.
  const chartData = useMemo(
    () => (data?.series ?? []).map((p) => ({ ...p, label: displayDate(String(p.date)) })),
    [data?.series],
  );

  const toggle = (list: string[], v: string, set: (x: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const unitSuffix = data && (metric === 'mae' || metric === 'bias')
    ? (data.unit === 'mixed' ? '' : data.unit) : '';

  if (error) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <strong className="font-semibold">Could not load forecast analytics.</strong>
        <div className="mt-1 font-mono text-xs">{error}</div>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-slate-600 dark:text-slate-300">Loading forecast performance…</div>;
  }

  const noData = data.totals.forecasts === 0;
  const mixedUnits = data.unit === 'mixed' && (metric === 'mae' || metric === 'bias');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Forecast Performance</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Every forecast logged in the{' '}
          <a href="/admin/forecasts" className="font-medium text-blue-700 underline dark:text-blue-400">Forecast Tracker</a>,
          scored against the NWS observation that settled it.{' '}
          {displayDate(data.range.from)} to {displayDate(data.range.to)}, compared with{' '}
          {displayDate(data.range.previous.from)} to {displayDate(data.range.previous.to)}.
        </p>
      </header>

      {/* Metric tiles — these SELECT the charted metric rather than adding to it. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map((t) => {
          const selected = metric === t.key;
          const d = data.deltas[t.key];
          const value = t.key === 'count' ? data.totals.verified : data.totals[t.key];
          const unit = t.key === 'mae' || t.key === 'bias' ? (data.unit === 'mixed' ? '' : data.unit) : '';
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setMetric(t.key)}
              aria-pressed={selected}
              title={t.help}
              className={[
                'rounded-xl border p-4 text-left transition-colors',
                selected
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:border-blue-400 dark:bg-slate-800 dark:ring-blue-400'
                  : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600',
              ].join(' ')}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {fmt(value, t.key)}
                {unit && <span className="ml-1 text-base font-medium text-slate-500 dark:text-slate-400">{unit}</span>}
              </div>
              {/* Direction is written out, never carried by colour alone. */}
              <div className="mt-1 text-xs tabular-nums">
                {d?.absolute == null ? (
                  <span className="text-slate-400 dark:text-slate-500">no prior period</span>
                ) : (
                  <span className={
                    d.direction === 'better' ? 'text-green-700 dark:text-green-400'
                      : d.direction === 'worse' ? 'text-red-700 dark:text-red-400'
                        : 'text-slate-500 dark:text-slate-400'
                  }>
                    {d.absolute > 0 ? '▲' : d.absolute < 0 ? '▼' : '■'} {Math.abs(d.absolute).toFixed(t.key === 'count' ? 0 : 2)}
                    {' '}{d.direction === 'flat' ? 'unchanged' : d.direction}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters, one row above the chart. */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <Field label="Range">
          <Select value={rangeKey} onChange={setRangeKey} options={RANGES.map((r) => ({ value: r.key, label: r.label }))} />
        </Field>
        <Field label="Interval">
          <Select
            value={granularity}
            onChange={(v) => setGranularity(v as 'auto' | 'day' | 'week')}
            options={[
              { value: 'auto', label: `Auto (${data.range.granularity})` },
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
            ]}
          />
        </Field>
        <Field label="Location">
          <Select
            value={location} onChange={setLocation}
            options={[{ value: '', label: `All (${data.facets.locations.length})` },
              ...data.facets.locations.map((l) => ({ value: l, label: l }))]}
          />
        </Field>
        <Field label="Lead time">
          <Select
            value={leadBucket} onChange={setLeadBucket}
            options={[{ value: '', label: 'All' }, ...data.facets.leadBuckets.map((l) => ({ value: l, label: l }))]}
          />
        </Field>
        <Field label="Measure">
          <div className="flex flex-wrap gap-1">
            {data.facets.metrics.map((m) => (
              <Chip key={m} active={metrics.includes(m)} onClick={() => toggle(metrics, m, setMetrics)}>
                {metricLabel(m)}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Source">
          <div className="flex flex-wrap gap-1">
            {data.facets.sources.map((s) => (
              <Chip key={s} active={sources.includes(s)} onClick={() => toggle(sources, s, setSources)} dot={colorFor(s, knownSources, dark)}>
                {sourceLabel(s)}
              </Chip>
            ))}
          </div>
        </Field>
        {(sources.length > 0 || metrics.length > 0 || location || leadBucket) && (
          <button
            type="button"
            onClick={() => { setSources([]); setMetrics([]); setLocation(''); setLeadBucket(''); }}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Clear filters
          </button>
        )}
      </div>

      {mixedUnits && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          This selection mixes temperature (°F) with wind (mph), so an error in those units has no single meaning.
          Filter to one measure, or use <strong>Accuracy score</strong>, which is comparable across both.
        </p>
      )}

      {/* Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {TILES.find((t) => t.key === metric)?.label}{unitSuffix ? ` (${unitSuffix})` : ''} by source
        </h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {TILES.find((t) => t.key === metric)?.help}
        </p>
        {noData ? (
          <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            No forecasts match these filters.
          </p>
        ) : (
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: theme.tickSecondary, fontSize: 11 }} stroke={theme.axis} minTickGap={24} />
                <YAxis
                  tick={{ fill: theme.tickSecondary, fontSize: 11 }} stroke={theme.axis} width={52}
                  domain={metric === 'accuracy' ? ['auto', 100] : ['auto', 'auto']}
                />
                {/* Bias is read against zero, so the zero line is part of the chart. */}
                {metric === 'bias' && <ReferenceLine y={0} stroke={theme.axis} strokeWidth={1} />}
                <Tooltip
                  contentStyle={{ background: theme.tooltipBg, border: 'none', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
                  itemStyle={{ color: theme.tooltipText }}
                  formatter={(v: any, name: any) => [v == null ? '—' : `${v}${unitSuffix}`, sourceLabel(String(name))]}
                />
                <Legend formatter={(v) => <span style={{ color: theme.tickPrimary, fontSize: 12 }}>{sourceLabel(String(v))}</span>} />
                {seriesKeys.map((k) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    name={k}
                    stroke={colorFor(k, knownSources, dark)}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? '#0f172a' : '#ffffff' }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Dimension tabs + table. Also the table view the light-mode palette owes. */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-700">
          {DIMENSIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDimension(d.key)}
              aria-current={dimension === d.key ? 'page' : undefined}
              className={[
                'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
                dimension === d.key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="px-4 py-2">{DIMENSIONS.find((d) => d.key === dimension)?.label}</th>
                <th className="px-4 py-2 text-right">Forecasts</th>
                <th className="px-4 py-2 text-right">Verified</th>
                <th className="px-4 py-2 text-right">Accuracy</th>
                <th className="px-4 py-2 text-right">Mean abs error</th>
                <th className="px-4 py-2 text-right">Bias</th>
              </tr>
            </thead>
            <tbody>
              {data.dimensionRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">Nothing in this selection.</td></tr>
              )}
              {data.dimensionRows.map((r) => (
                <tr key={r.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                    <span className="inline-flex items-center gap-2">
                      {dimension === 'source' && (
                        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorFor(r.key, knownSources, dark) }} />
                      )}
                      {dimension === 'source' ? sourceLabel(r.key) : dimension === 'metric' ? metricLabel(r.key) : r.key}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{r.forecasts.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{r.verified.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{r.accuracy == null ? '—' : r.accuracy.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{r.mae == null ? '—' : r.mae.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{r.bias == null ? '—' : (r.bias > 0 ? '+' : '') + r.bias.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dimension === 'source' && (
          <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Sources are not automatically like for like: each one is logged at its own mix of lead times and locations,
            and a forecast made ten days out is a harder forecast than one made this morning. To compare fairly, pin
            <strong> Lead time</strong> above (most of the book sits in 3-5d) and pick a single <strong>Measure</strong>.
          </p>
        )}
      </div>

      {loading && <p className="text-xs text-slate-500 dark:text-slate-400">Updating…</p>}
    </div>
  );
}

// ── Small controls ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Chip({ active, onClick, children, dot }: {
  active: boolean; onClick: () => void; children: React.ReactNode; dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-slate-800 dark:text-blue-200'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
      ].join(' ')}
    >
      {dot && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}
