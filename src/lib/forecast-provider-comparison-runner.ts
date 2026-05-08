// ── Step 136: Admin-only forecast provider comparison runner ────────────────
//
// Server-only orchestrator. Fetches the same lat/lon/days forecast from
// each requested provider in parallel, isolates per-provider failures so
// one slow/broken provider can't poison the whole comparison, and feeds
// the results into compareProviderForecasts() for completeness/freshness/
// delta analysis.
//
// Strict trust posture:
//   - Server-only — browser-import throws.
//   - No PII, no betting data, no admin-only operator metadata enters
//     the result. Only forecast values + structured failure notes.
//   - Never throws. Per-provider failures are caught and recorded.
//   - Does NOT change normal public forecast fetching behavior. The
//     public weather page continues to use `getForecast` + the env-driven
//     resolver.

import { getOpenMeteoForecast } from './open-meteo';
import { fetchBigQueryWeatherNextSample } from './weather-queries';
import { tryWeatherNextForecast } from './weathernext-client';
import { FORECAST_PROVIDER_CAPABILITIES } from './forecast-provider-metadata';
import {
  compareProviderForecasts,
  type ProviderRunResult,
  type ProviderComparisonResult,
} from './forecast-provider-comparison';
import type { ForecastResponse } from './types';
import type { ForecastProvider } from './forecast-source';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-provider-comparison-runner is server-only and must not be imported in client code',
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface RunComparisonOptions {
  lat: number;
  lon: number;
  days?: number;
  /** Optional admin-supplied label (e.g., "Columbia, SC 29209"). */
  label?: string;
  /** Explicit opt-in for the BigQuery WeatherNext sample fetch. */
  includeWeatherNextSample?: boolean;
  /** Explicit opt-in for the WeatherNext production (Vertex AI) attempt. */
  includeWeatherNextProduction?: boolean;
  /** Step 138: optional pointer back to a seeded city so the batch report
   * runner can pair stored snapshots to their seed without lat/lon
   * fuzzy-matching. Backward-compatible — undefined for ad-hoc runs. */
  seedCityId?: string;
}

// ── Output ──────────────────────────────────────────────────────────────────

export interface ComparisonRun {
  id: string;
  /** ISO timestamp of the run. */
  runAt: string;
  /** ISO timestamp the request was created (server clock). */
  generatedAt: string;
  lat: number;
  lon: number;
  days: number;
  label?: string;
  /** Step 138: pointer back to the seeded city, when this run originated
   * from the batch runner. */
  seedCityId?: string;
  providers: ProviderRunResult[];
  comparison: ProviderComparisonResult;
}

// ── Per-provider safe runners ───────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; durationMs: number; error?: any }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, durationMs: Date.now() - start };
  } catch (error: any) {
    return { error, durationMs: Date.now() - start };
  }
}

function labelFor(provider: ForecastProvider, forecastLabel?: string): string {
  if (forecastLabel) return forecastLabel;
  return FORECAST_PROVIDER_CAPABILITIES[provider]?.label ?? provider;
}

async function runOpenMeteo(lat: number, lon: number, days: number): Promise<ProviderRunResult> {
  const t = await timed(() => getOpenMeteoForecast(lat, lon, days));
  if (t.error || !t.value) {
    return {
      provider: 'open-meteo',
      label: labelFor('open-meteo'),
      ok: false,
      failureMode: 'open_meteo_error',
      notes: [String(t.error?.message ?? 'Open-Meteo fetch failed')],
      durationMs: t.durationMs,
    };
  }
  return {
    provider: 'open-meteo',
    label: labelFor('open-meteo', t.value.source?.label),
    ok: true,
    forecast: t.value,
    notes: [],
    durationMs: t.durationMs,
  };
}

async function runWeatherNextSample(lat: number, lon: number, days: number): Promise<ProviderRunResult> {
  const t = await timed(() => fetchBigQueryWeatherNextSample(lat, lon, days));
  if (t.error || !t.value) {
    return {
      provider: 'weathernext-bigquery-sample',
      label: labelFor('weathernext-bigquery-sample'),
      ok: false,
      failureMode: 'bigquery_sample_error',
      notes: [String(t.error?.message ?? 'BigQuery sample fetch failed')],
      durationMs: t.durationMs,
    };
  }
  return {
    provider: 'weathernext-bigquery-sample',
    label: labelFor('weathernext-bigquery-sample', t.value.source?.label),
    ok: true,
    forecast: t.value,
    notes: ['Research/preview dataset — fields may be derived or fabricated. See forecast-provider-capabilities.md.'],
    durationMs: t.durationMs,
  };
}

async function runWeatherNextProduction(lat: number, lon: number, days: number): Promise<ProviderRunResult> {
  const t = await timed(() => tryWeatherNextForecast(lat, lon, days));
  if (t.error) {
    return {
      provider: 'weathernext-production',
      label: labelFor('weathernext-production'),
      ok: false,
      failureMode: 'unknown',
      notes: [`tryWeatherNextForecast threw unexpectedly (it shouldn't): ${String(t.error?.message ?? t.error)}`],
      durationMs: t.durationMs,
    };
  }
  const result = t.value!;
  if (result.ok) {
    return {
      provider: 'weathernext-production',
      label: labelFor('weathernext-production'),
      ok: true,
      forecast: result.forecast,
      notes: result.notes,
      durationMs: t.durationMs,
    };
  }
  return {
    provider: 'weathernext-production',
    label: labelFor('weathernext-production'),
    ok: false,
    failureMode: result.failureMode,
    notes: result.notes,
    durationMs: t.durationMs,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

function newRunId(): string {
  return `fpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runProviderComparison(opts: RunComparisonOptions): Promise<ComparisonRun> {
  if (!Number.isFinite(opts.lat) || !Number.isFinite(opts.lon)) {
    throw new Error('runProviderComparison: lat and lon must be finite numbers');
  }
  const days = Math.max(1, Math.min(15, Math.floor(opts.days ?? 5)));

  const tasks: Array<Promise<ProviderRunResult>> = [runOpenMeteo(opts.lat, opts.lon, days)];
  if (opts.includeWeatherNextSample) tasks.push(runWeatherNextSample(opts.lat, opts.lon, days));
  if (opts.includeWeatherNextProduction) tasks.push(runWeatherNextProduction(opts.lat, opts.lon, days));

  const providers = await Promise.all(tasks);
  const comparison = compareProviderForecasts(providers);

  const runAt = new Date().toISOString();
  return {
    id: newRunId(),
    runAt,
    generatedAt: runAt,
    lat: opts.lat,
    lon: opts.lon,
    days,
    label: opts.label,
    seedCityId: opts.seedCityId,
    providers,
    comparison,
  };
}

/**
 * Step 137: per-horizon snapshot of provider forecast values, captured at
 * snapshot time so the quality-gate runner can score them against NWS
 * observations once the target hours elapse. Optional fields — providers
 * that don't expose hourly data, or hourly entries outside ±90 min of the
 * target hour, leave the slot undefined and the quality gate marks the
 * (provider, horizon) cell "unavailable".
 */
export interface ProviderHorizonPoint {
  tempF?: number;
  windMph?: number;
  gustMph?: number;
}

export interface ProviderHorizonValues {
  h0?: ProviderHorizonPoint;
  h6?: ProviderHorizonPoint;
  h12?: ProviderHorizonPoint;
  h24?: ProviderHorizonPoint;
}

/**
 * Compact projection of a `ComparisonRun` suitable for snapshot persistence
 * — drops the raw `forecast` payloads and keeps only what the UI needs to
 * render historical entries.
 */
export interface CompactComparisonRun {
  id: string;
  runAt: string;
  lat: number;
  lon: number;
  days: number;
  label?: string;
  /** Step 138: pointer back to the seeded city when this snapshot came
   * from the batch runner. Optional. */
  seedCityId?: string;
  providerSummaries: Array<{
    provider: string;
    label: string;
    ok: boolean;
    failureMode?: string;
    durationMs: number;
    notes: string[];
  }>;
  comparison: ProviderComparisonResult;
  /** Step 137: per-provider horizon values for retroactive observation
   * scoring. Optional — older snapshots predate this field and mark every
   * horizon as unavailable in the quality gate. */
  providerHorizonValues?: Record<string, ProviderHorizonValues>;
}

const HORIZON_TARGETS: Array<{ key: keyof ProviderHorizonValues; offsetMs: number }> = [
  { key: 'h0', offsetMs: 0 },
  { key: 'h6', offsetMs: 6 * 3600 * 1000 },
  { key: 'h12', offsetMs: 12 * 3600 * 1000 },
  { key: 'h24', offsetMs: 24 * 3600 * 1000 },
];

const HORIZON_TOLERANCE_MS = 90 * 60 * 1000; // ±90 min

function extractProviderHorizonValues(
  forecast: ForecastResponse | undefined,
  runAtMs: number,
): ProviderHorizonValues {
  if (!forecast?.hourly || forecast.hourly.length === 0) return {};
  const out: ProviderHorizonValues = {};
  for (const target of HORIZON_TARGETS) {
    const targetMs = runAtMs + target.offsetMs;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < forecast.hourly.length; i++) {
      const t = Date.parse(forecast.hourly[i].time);
      if (!Number.isFinite(t)) continue;
      const d = Math.abs(t - targetMs);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDiff <= HORIZON_TOLERANCE_MS) {
      const pt = forecast.hourly[bestIdx];
      out[target.key] = {
        tempF: typeof pt.tempF === 'number' ? Math.round(pt.tempF) : undefined,
        windMph: typeof pt.windSpeedMph === 'number' ? Math.round(pt.windSpeedMph) : undefined,
        gustMph: typeof pt.windGustMph === 'number' ? Math.round(pt.windGustMph) : undefined,
      };
    }
  }
  return out;
}

export function toCompactRun(run: ComparisonRun): CompactComparisonRun {
  const runAtMs = Date.parse(run.runAt) || Date.now();
  const providerHorizonValues: Record<string, ProviderHorizonValues> = {};
  for (const p of run.providers) {
    if (p.ok && p.forecast) {
      const hv = extractProviderHorizonValues(p.forecast, runAtMs);
      if (Object.keys(hv).length > 0) providerHorizonValues[p.provider] = hv;
    }
  }
  return {
    id: run.id,
    runAt: run.runAt,
    lat: run.lat,
    lon: run.lon,
    days: run.days,
    label: run.label,
    seedCityId: run.seedCityId,
    providerSummaries: run.providers.map((p) => ({
      provider: p.provider,
      label: p.label,
      ok: p.ok,
      failureMode: p.failureMode,
      durationMs: p.durationMs,
      notes: p.notes,
    })),
    comparison: run.comparison,
    providerHorizonValues:
      Object.keys(providerHorizonValues).length > 0 ? providerHorizonValues : undefined,
  };
}
