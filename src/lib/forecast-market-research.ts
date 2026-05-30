// ── Forecast Market Research (admin-only) ───────────────────────────────────
//
// Enriched, operator-facing forecast intelligence for SETTING MARKETS. This
// is the admin counterpart to the four lightweight public cards (Forecast
// Outlook / Changes / History / Market Context) that used to live on the ZIP
// weather pages. Those cards were deliberately thin and non-advisory for
// customers; here we keep their full output AND layer on the extra research a
// trader actually wants when picking an over/under line:
//
//   • multi-day daily outlook (highs/lows/precip/wind for the whole horizon)
//   • next-24h hourly detail
//   • temperature dispersion stats
//   • per-day model VOLATILITY across captured snapshots (how much the
//     forecast high/low for a given date has wobbled run-to-run)
//   • suggested market lines with a confidence read + plain-English rationale
//
// Pure data assembly — no Redis, no fetch, no betting/settlement side effects.
// The API route is responsible for loading the forecast + snapshots and the
// four builder outputs, then handing them here.

import type { ForecastResponse } from './types';
import type { ForecastSnapshot } from './forecast-revision-store';
import type { ForecastIntelligenceSummary } from './forecast-intelligence';
import type { ForecastRevisionSummary } from './forecast-revision-analysis';
import type { ForecastTimelineResult } from './forecast-timeline';
import type { WeatherMarketContextSummary } from './weather-market-context';

// ── Public shapes ────────────────────────────────────────────────────────────

export interface DailyOutlookRow {
  date: string;
  dayLabel: string;
  highF: number;
  lowF: number;
  precipProbability: number;
  windSpeedMph: number;
  windGustMph: number;
}

export interface HourlyRow {
  time: string;
  hourLabel: string;
  tempF: number;
  precipProbability: number;
  windSpeedMph: number;
  windGustMph: number;
}

export interface TempStats {
  hourlyMinF: number;
  hourlyMaxF: number;
  hourlyMeanF: number;
  hourlyStdDevF: number;
  hourlyRangeF: number;
  /** Spread between the highest daily high and lowest daily low across the horizon. */
  dailyHighSpreadF: number;
}

export type VolatilityStability = 'firm' | 'moving' | 'unsettled' | 'insufficient';

export interface MetricVolatility {
  metric: 'high_temp' | 'low_temp';
  date: string;
  dayLabel: string;
  /** Number of captured snapshots that included this date. */
  captures: number;
  /** Model values for this date, oldest → newest. */
  values: number[];
  latest: number | null;
  min: number | null;
  max: number | null;
  rangeF: number | null;
  stdDevF: number | null;
  stability: VolatilityStability;
}

export interface SuggestedMarketLine {
  metric: 'high_temp' | 'low_temp';
  date: string;
  dayLabel: string;
  forecastValueF: number;
  /** Whole-number line candidate (e.g. 87). */
  suggestedLine: number;
  /** Push-proof alternative (e.g. 86.5 / 87.5) for venues that allow half-lines. */
  pushProofLine: number;
  confidence: 'high' | 'moderate' | 'low';
  rationale: string;
}

export interface MarketResearch {
  generatedAt: string;
  location: { label: string; zip: string; city: string; state: string; lat: number; lon: number };
  source: string | null;
  forecastGeneratedAt: string | null;
  // Full-fidelity versions of the four formerly-public sections.
  intelligence: ForecastIntelligenceSummary;
  revision: ForecastRevisionSummary;
  timeline: ForecastTimelineResult;
  marketContext: WeatherMarketContextSummary;
  // Enriched market-setting research.
  dailyOutlook: DailyOutlookRow[];
  hourlyNext24: HourlyRow[];
  tempStats: TempStats;
  volatility: MetricVolatility[];
  suggestedLines: SuggestedMarketLine[];
  snapshotCount: number;
  snapshotWindow: { earliest: string | null; latest: string | null };
}

// ── Small math helpers ───────────────────────────────────────────────────────

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

function hourLabel(iso: string): string {
  // ForecastPoint.time is local wall-clock ISO (no Z); take the hour directly.
  const m = iso.match(/T(\d{2})/);
  if (!m) return iso;
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h} ${ampm}`;
}

// ── Volatility across snapshots ──────────────────────────────────────────────

function classifyStability(captures: number, stdDevF: number | null): VolatilityStability {
  if (captures < 2 || stdDevF === null) return 'insufficient';
  if (stdDevF < 1.0) return 'firm';
  if (stdDevF < 2.5) return 'moving';
  return 'unsettled';
}

/**
 * For a given target date and metric, walk the captured snapshots (passed
 * newest-first as `listSnapshots` returns them) and pull the modelled value
 * for that date out of each snapshot's 7-day `daily` array. Returns the
 * chronological (oldest→newest) series plus dispersion stats.
 */
function metricVolatility(
  snapshots: ForecastSnapshot[],
  date: string,
  metric: 'high_temp' | 'low_temp',
): MetricVolatility {
  const valuesNewestFirst: number[] = [];
  for (const snap of snapshots) {
    const row = snap.daily.find((d) => d.date === date);
    if (!row) continue;
    valuesNewestFirst.push(metric === 'high_temp' ? row.highF : row.lowF);
  }
  const values = valuesNewestFirst.slice().reverse(); // oldest → newest
  const captures = values.length;
  const latest = captures > 0 ? valuesNewestFirst[0] : null;
  const min = captures > 0 ? Math.min(...values) : null;
  const max = captures > 0 ? Math.max(...values) : null;
  const rangeF = min !== null && max !== null ? round1(max - min) : null;
  const sd = captures >= 2 ? round1(stddev(values)) : null;
  return {
    metric,
    date,
    dayLabel: dayLabel(date),
    captures,
    values,
    latest,
    min,
    max,
    rangeF,
    stdDevF: sd,
    stability: classifyStability(captures, sd),
  };
}

// ── Suggested lines ──────────────────────────────────────────────────────────

function combineConfidence(
  base: ForecastIntelligenceSummary['confidence'],
  stability: VolatilityStability,
): 'high' | 'moderate' | 'low' {
  if (stability === 'unsettled') return 'low';
  if (stability === 'moving') return base === 'high' ? 'moderate' : base;
  // firm or insufficient → defer to the base forecast confidence
  return base;
}

function suggestedLine(
  metric: 'high_temp' | 'low_temp',
  row: DailyOutlookRow,
  vol: MetricVolatility | undefined,
  intelligence: ForecastIntelligenceSummary,
): SuggestedMarketLine {
  const forecastValueF = metric === 'high_temp' ? row.highF : row.lowF;
  const rounded = Math.round(forecastValueF);
  const stability = vol?.stability ?? 'insufficient';
  const confidence = combineConfidence(intelligence.confidence, stability);

  const parts: string[] = [];
  parts.push(`Forecast ${metric === 'high_temp' ? 'high' : 'low'} ${Math.round(forecastValueF)}°F.`);
  if (vol && vol.captures >= 2 && vol.rangeF !== null) {
    parts.push(
      `Across ${vol.captures} captured run${vol.captures === 1 ? '' : 's'} this date has spanned ` +
        `${vol.min}–${vol.max}°F (±${vol.stdDevF}°, ${stability}).`,
    );
  } else {
    parts.push('No revision history yet for this date — confidence rests on the live forecast only.');
  }
  if (intelligence.hasActiveSevereAlert) {
    parts.push('A severe alert is active — widen or hold off.');
  }

  return {
    metric,
    date: row.date,
    dayLabel: row.dayLabel,
    forecastValueF: round1(forecastValueF),
    suggestedLine: rounded,
    pushProofLine: rounded + 0.5,
    confidence,
    rationale: parts.join(' '),
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

export interface BuildMarketResearchArgs {
  forecast: ForecastResponse;
  snapshots: ForecastSnapshot[]; // newest-first
  intelligence: ForecastIntelligenceSummary;
  revision: ForecastRevisionSummary;
  timeline: ForecastTimelineResult;
  marketContext: WeatherMarketContextSummary;
  location: { label: string; zip: string; city: string; state: string; lat: number; lon: number };
  /** ISO string stamped by the caller (scripts can't call Date in some envs). */
  generatedAt: string;
}

export function buildMarketResearch(args: BuildMarketResearchArgs): MarketResearch {
  const { forecast, snapshots, intelligence, revision, timeline, marketContext, location, generatedAt } = args;
  const daily = forecast.daily ?? [];
  const hourly = forecast.hourly ?? [];

  const dailyOutlook: DailyOutlookRow[] = daily.map((d) => ({
    date: d.date,
    dayLabel: dayLabel(d.date),
    highF: Math.round(d.highF),
    lowF: Math.round(d.lowF),
    precipProbability: d.precipProbability,
    windSpeedMph: Math.round(d.windSpeedMph),
    windGustMph: Math.round(d.windGustMph),
  }));

  const next24 = hourly.slice(0, 24);
  const hourlyNext24: HourlyRow[] = next24.map((p) => ({
    time: p.time,
    hourLabel: hourLabel(p.time),
    tempF: Math.round(p.tempF),
    precipProbability: p.precipProbability,
    windSpeedMph: Math.round(p.windSpeedMph),
    windGustMph: Math.round(p.windGustMph),
  }));

  const temps = next24.map((p) => p.tempF);
  const dailyHighs = daily.map((d) => d.highF);
  const dailyLows = daily.map((d) => d.lowF);
  const tempStats: TempStats = {
    hourlyMinF: temps.length ? Math.round(Math.min(...temps)) : 0,
    hourlyMaxF: temps.length ? Math.round(Math.max(...temps)) : 0,
    hourlyMeanF: round1(avg(temps)),
    hourlyStdDevF: round1(stddev(temps)),
    hourlyRangeF: temps.length ? Math.round(Math.max(...temps) - Math.min(...temps)) : 0,
    dailyHighSpreadF:
      dailyHighs.length && dailyLows.length ? Math.round(Math.max(...dailyHighs) - Math.min(...dailyLows)) : 0,
  };

  // Volatility + suggested lines for the first few days (where snapshot
  // history overlaps the 7-day snapshot window most reliably).
  const horizon = dailyOutlook.slice(0, 5);
  const volatility: MetricVolatility[] = [];
  const suggestedLines: SuggestedMarketLine[] = [];
  for (const row of horizon) {
    const highVol = metricVolatility(snapshots, row.date, 'high_temp');
    const lowVol = metricVolatility(snapshots, row.date, 'low_temp');
    volatility.push(highVol, lowVol);
    suggestedLines.push(suggestedLine('high_temp', row, highVol, intelligence));
    suggestedLines.push(suggestedLine('low_temp', row, lowVol, intelligence));
  }

  const captured = snapshots.map((s) => s.capturedAt).filter(Boolean).sort();

  return {
    generatedAt,
    location,
    source: forecast.source?.label ?? null,
    forecastGeneratedAt: forecast.generatedAt ?? null,
    intelligence,
    revision,
    timeline,
    marketContext,
    dailyOutlook,
    hourlyNext24,
    tempStats,
    volatility,
    suggestedLines,
    snapshotCount: snapshots.length,
    snapshotWindow: {
      earliest: captured.length ? captured[0] : null,
      latest: captured.length ? captured[captured.length - 1] : null,
    },
  };
}
