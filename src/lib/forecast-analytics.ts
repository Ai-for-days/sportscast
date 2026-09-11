// Aggregation for the Forecast Performance dashboard (/admin/forecast-performance).
//
// The Forecast Tracker at /admin/forecasts has been logging every source's
// forecast against the NWS observation that settled it since 2026-03. That is
// thousands of scored predictions and, until now, nothing read them back except
// one flat table. This module turns them into the Search-Console-shaped
// question an operator actually has: **is our forecast better than theirs, and
// where is it worse?**
//
// Pure functions over plain rows: no Redis, no fetch, no clock. The API route
// loads the entries; everything here is testable without a network.
//
// ── Two things that make this domain different from web analytics ───────────
//
// 1. THE METRICS DISAGREE ABOUT DIRECTION. A higher accuracy score is better; a
//    higher mean absolute error is worse; a bias is better the closer it sits
//    to zero, in either direction. A period-over-period delta is therefore
//    meaningless without knowing which metric it belongs to, so `deltaOf` takes
//    the metric and returns an explicit 'better' | 'worse' | 'flat'.
//
// 2. THE UNITS DISAGREE. Temperature errors are °F and wind errors are mph.
//    Averaging them produces a number with no unit and no meaning. `unitFor`
//    reports 'mixed' when a selection spans both, and the UI labels it rather
//    than quietly printing a figure that means nothing. Accuracy score is the
//    only cross-metric-comparable measure here, which is why it is the default.

import type { ForecastEntry } from './forecast-tracker-types';
import { normalizeSource, getMetricGroup } from './forecast-verification-v2';

// ── Row shape ───────────────────────────────────────────────────────────────

/** One scored forecast, flattened to exactly what the dashboard groups by. */
export interface AnalyticsRow {
  targetDate: string;   // YYYY-MM-DD
  source: string;       // normalized: 'wageronweather-consensus', 'nws', ...
  metric: string;       // 'high_temp', 'wind_speed', ...
  metricGroup: string;  // 'temperature' | 'wind' | 'unknown'
  location: string;
  leadBucket: string;
  /** Null until the entry is verified against an observation. */
  absError: number | null;
  signedError: number | null;
  accuracy: number | null;
  verified: boolean;
}

/**
 * Flatten stored entries into rows.
 *
 * `sourceNormalized`, `leadBucket` and the v2 error fields are written by
 * `computeV2Fields` at VERIFICATION time, so an entry that is still waiting on
 * its observation has none of them. Deriving source and group here rather than
 * trusting the stored copies keeps unverified entries countable (they are real
 * forecasts that were made) instead of collapsing into an "undefined" bucket.
 */
export function toRows(entries: ForecastEntry[]): AnalyticsRow[] {
  const out: AnalyticsRow[] = [];
  for (const e of entries) {
    if (!e || !e.targetDate) continue;
    const verified = e.actualValue != null;
    // Fall back to the v1 field so entries predating the v2 backfill still count.
    const absError = e.absError ?? e.errorAbs ?? null;
    const accuracy = e.accuracyScoreV2 ?? e.accuracyScore ?? null;
    out.push({
      targetDate: e.targetDate,
      source: e.sourceNormalized || normalizeSource(e.source),
      metric: e.metric,
      metricGroup: e.metricGroup || getMetricGroup(e.metric),
      location: e.locationName || 'Unknown',
      leadBucket: e.leadBucket || bucketFromHours(e.leadTimeHours),
      absError: verified ? absError : null,
      signedError: verified ? (e.signedError ?? null) : null,
      accuracy: verified ? accuracy : null,
      verified,
    });
  }
  return out;
}

/** Mirrors getLeadBucket, for entries verified before leadBucket was stored. */
function bucketFromHours(h: number | undefined): string {
  if (typeof h !== 'number' || !Number.isFinite(h)) return 'unknown';
  if (h <= 1) return '0-1h';
  if (h <= 6) return '1-6h';
  if (h <= 24) return '6-24h';
  if (h <= 72) return '1-3d';
  if (h <= 120) return '3-5d';
  if (h <= 168) return '5-7d';
  if (h <= 240) return '7-10d';
  if (h <= 336) return '10-14d';
  return '14d+';
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export type MetricKey = 'accuracy' | 'mae' | 'bias' | 'count';

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** How to read a change. 'zero' means closer to zero is better, either way. */
  better: 'higher' | 'lower' | 'zero';
  /** Whether the figure carries the selection's physical unit (°F / mph). */
  unitized: boolean;
  help: string;
}

export const METRICS: Record<MetricKey, MetricDef> = {
  accuracy: {
    key: 'accuracy', label: 'Accuracy score', better: 'higher', unitized: false,
    help: '0-100, difficulty-adjusted. The only measure comparable across temperature and wind.',
  },
  mae: {
    key: 'mae', label: 'Mean abs error', better: 'lower', unitized: true,
    help: 'Average miss, ignoring direction.',
  },
  bias: {
    key: 'bias', label: 'Bias', better: 'zero', unitized: true,
    help: 'Average signed miss. Positive = forecasting too high.',
  },
  count: {
    key: 'count', label: 'Forecasts', better: 'higher', unitized: false,
    help: 'Verified forecasts in the selection.',
  },
};

export type DimensionKey = 'source' | 'metric' | 'location' | 'leadBucket';

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  source: 'Source',
  metric: 'Metric',
  location: 'Location',
  leadBucket: 'Lead time',
};

// ── Filtering ───────────────────────────────────────────────────────────────

export interface Filters {
  from?: string;          // YYYY-MM-DD inclusive
  to?: string;            // YYYY-MM-DD inclusive
  sources?: string[];
  metrics?: string[];
  locations?: string[];
  leadBuckets?: string[];
}

export function filterRows(rows: AnalyticsRow[], f: Filters = {}): AnalyticsRow[] {
  const has = (a: string[] | undefined) => Array.isArray(a) && a.length > 0;
  return rows.filter((r) => {
    if (f.from && r.targetDate < f.from) return false;
    if (f.to && r.targetDate > f.to) return false;
    if (has(f.sources) && !f.sources!.includes(r.source)) return false;
    if (has(f.metrics) && !f.metrics!.includes(r.metric)) return false;
    if (has(f.locations) && !f.locations!.includes(r.location)) return false;
    if (has(f.leadBuckets) && !f.leadBuckets!.includes(r.leadBucket)) return false;
    return true;
  });
}

// ── Units ───────────────────────────────────────────────────────────────────

export type Unit = '°F' | 'mph' | 'mixed' | '';

/**
 * The unit a unitized figure would carry for this selection.
 *
 * 'mixed' is not a formatting nicety. A mean that averages 3.2°F with 4.1 mph
 * is a number with no referent, and printing it with any unit at all would be a
 * lie about what was measured.
 */
export function unitFor(rows: AnalyticsRow[]): Unit {
  let temp = false, wind = false;
  for (const r of rows) {
    if (!r.verified) continue;
    if (r.metricGroup === 'temperature') temp = true;
    else if (r.metricGroup === 'wind') wind = true;
    if (temp && wind) return 'mixed';
  }
  if (temp) return '°F';
  if (wind) return 'mph';
  return '';
}

// ── Aggregates ──────────────────────────────────────────────────────────────

export interface Totals {
  forecasts: number;   // rows in selection, verified or not
  verified: number;    // rows with an observation to score against
  accuracy: number | null;
  mae: number | null;
  bias: number | null;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function totals(rows: AnalyticsRow[]): Totals {
  const v = rows.filter((r) => r.verified);
  return {
    forecasts: rows.length,
    verified: v.length,
    accuracy: round1(mean(v.map((r) => r.accuracy).filter(isNum))),
    mae: round2(mean(v.map((r) => r.absError).filter(isNum))),
    bias: round2(mean(v.map((r) => r.signedError).filter(isNum))),
  };
}

function isNum(x: number | null): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function round1(x: number | null): number | null {
  return x == null ? null : Math.round(x * 10) / 10;
}
function round2(x: number | null): number | null {
  return x == null ? null : Math.round(x * 100) / 100;
}

/** Read one metric off a Totals. */
export function valueOf(t: Totals, m: MetricKey): number | null {
  return m === 'count' ? t.verified : t[m];
}

// ── Time series ─────────────────────────────────────────────────────────────

export type Granularity = 'day' | 'week';

/** Monday-anchored week start, in plain UTC date arithmetic. */
export function weekStart(dateStr: string): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return dateStr;
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Daily is unreadable across a six-month range and weekly hides a bad
 * weekend inside a 28-day one, so the default follows the range rather than
 * making the operator think about it.
 */
export function autoGranularity(from: string, to: string): Granularity {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  return Number.isFinite(days) && days > 70 ? 'week' : 'day';
}

export interface SeriesPoint {
  date: string;
  /** One entry per series key (a source, or 'all'). Null = no data that bucket,
   *  which recharts renders as a gap rather than joining across it. */
  [seriesKey: string]: string | number | null;
}

/**
 * One point per bucket, one key per series. Series are the SOURCES, because the
 * question this page exists to answer is which source is more accurate.
 */
export function seriesByDate(
  rows: AnalyticsRow[],
  metric: MetricKey,
  granularity: Granularity,
  seriesKeys: string[],
): SeriesPoint[] {
  const bucketOf = (d: string) => (granularity === 'week' ? weekStart(d) : d);
  // bucket -> source -> rows
  const buckets = new Map<string, Map<string, AnalyticsRow[]>>();
  for (const r of rows) {
    const b = bucketOf(r.targetDate);
    let bySource = buckets.get(b);
    if (!bySource) buckets.set(b, (bySource = new Map()));
    const list = bySource.get(r.source);
    if (list) list.push(r);
    else bySource.set(r.source, [r]);
  }
  const out: SeriesPoint[] = [];
  for (const date of [...buckets.keys()].sort()) {
    const bySource = buckets.get(date)!;
    const point: SeriesPoint = { date };
    for (const key of seriesKeys) {
      const list = bySource.get(key);
      point[key] = list ? valueOf(totals(list), metric) : null;
    }
    out.push(point);
  }
  return out;
}

// ── Dimension breakdown ─────────────────────────────────────────────────────

export interface DimensionRow extends Totals {
  key: string;
}

export function byDimension(rows: AnalyticsRow[], dim: DimensionKey): DimensionRow[] {
  const groups = new Map<string, AnalyticsRow[]>();
  for (const r of rows) {
    const k = r[dim];
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, ...totals(list) }))
    .sort((a, b) => b.verified - a.verified);
}

// ── Period comparison ───────────────────────────────────────────────────────

export interface Period { from: string; to: string; }

/**
 * The equally-long window ending the day before `from`, which is what "compare
 * to previous period" means in every analytics tool.
 */
export function previousPeriod(p: Period): Period {
  const fromMs = Date.parse(`${p.from}T00:00:00Z`);
  const toMs = Date.parse(`${p.to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return p;
  const span = toMs - fromMs + 86400000; // inclusive
  return {
    from: new Date(fromMs - span).toISOString().slice(0, 10),
    to: new Date(toMs - span).toISOString().slice(0, 10),
  };
}

export interface Delta {
  absolute: number | null;
  percent: number | null;
  direction: 'better' | 'worse' | 'flat';
}

/**
 * A signed change plus what it MEANS for this metric, since a rise is good for
 * accuracy, bad for error, and for bias depends on which side of zero it moved.
 */
export function deltaOf(current: number | null, previous: number | null, metric: MetricKey): Delta {
  if (current == null || previous == null) return { absolute: null, percent: null, direction: 'flat' };
  const absolute = round2(current - previous)!;
  const percent = previous === 0 ? null : round1(((current - previous) / Math.abs(previous)) * 100);
  const def = METRICS[metric];
  let direction: Delta['direction'] = 'flat';
  if (absolute !== 0) {
    if (def.better === 'higher') direction = absolute > 0 ? 'better' : 'worse';
    else if (def.better === 'lower') direction = absolute < 0 ? 'better' : 'worse';
    else direction = Math.abs(current) < Math.abs(previous) ? 'better' : 'worse';
  }
  return { absolute, percent, direction };
}

// ── Option lists for the filter controls ────────────────────────────────────

export interface FacetOptions {
  sources: string[];
  metrics: string[];
  locations: string[];
  leadBuckets: string[];
  minDate: string;
  maxDate: string;
}

/** Lead buckets read as a progression, not alphabetically. */
const LEAD_ORDER = ['0-1h', '1-6h', '6-24h', '1-3d', '3-5d', '5-7d', '7-10d', '10-14d', '14d+', 'unknown'];

export function facetOptions(rows: AnalyticsRow[]): FacetOptions {
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const dates = rows.map((r) => r.targetDate).sort();
  return {
    sources: uniq(rows.map((r) => r.source)),
    metrics: uniq(rows.map((r) => r.metric)),
    locations: uniq(rows.map((r) => r.location)),
    leadBuckets: [...new Set(rows.map((r) => r.leadBucket))]
      .sort((a, b) => LEAD_ORDER.indexOf(a) - LEAD_ORDER.indexOf(b)),
    minDate: dates[0] ?? '',
    maxDate: dates[dates.length - 1] ?? '',
  };
}
