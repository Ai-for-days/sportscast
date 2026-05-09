// ── Step 142: Forecast provider smoke-test harness (server-only) ────────────
//
// Admin-only diagnostics for forecast-provider readiness. Predefined,
// per-provider tests — **no arbitrary SQL or endpoint URL ever flows
// from the UI into a query / fetch**. Each test is hardcoded to call
// either an existing safe wrapper (Open-Meteo, BigQuery sample) or a
// readiness-only check (Vertex AI, BigQuery production) so an operator
// can never accidentally run a guess.
//
// Per-provider isolation: each smoke test catches its own errors and
// returns a structured result rather than throwing. The caller never
// gets a partial success from one provider mixed with a thrown error
// from another.
//
// Settlement boundary unchanged: this layer reads forecasts via
// existing helpers but writes nothing to wager / bet / wallet stores
// and does not touch grading.

import type { ForecastProvider } from './forecast-source';
import { getOpenMeteoForecast } from './open-meteo';
import { fetchBigQueryWeatherNextSample } from './weather-queries';
import {
  getWeatherNextReadiness,
  type WeatherNextReadiness,
} from './weathernext-readiness';
import {
  getWeatherNextBigQueryReadiness,
  type WeatherNextBigQueryReadiness,
} from './weathernext-bigquery-readiness';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-provider-smoke-tests is server-only and must not be imported in client code',
  );
}

// ── Public types ────────────────────────────────────────────────────────────

export type SmokeTestStatus =
  /** A live request actually succeeded against the provider. */
  | 'live_call_ok'
  /** A live request failed. */
  | 'live_call_failed'
  /** Config check ran and returned ready. (Used for readiness-only providers.) */
  | 'readiness_ok'
  /** Required env is missing. */
  | 'unconfigured'
  /** Env present but the contract / endpoint / schema is not yet confirmed. */
  | 'contract_unconfirmed'
  /** Operator opted out of the live call (e.g. BigQuery sample without explicit opt-in). */
  | 'skipped'
  /** Anything else. */
  | 'failed';

export interface SmokeTestResult {
  provider: ForecastProvider;
  label: string;
  ok: boolean;
  status: SmokeTestStatus;
  /** Wall-clock duration for the smoke test, in ms. */
  durationMs: number;
  /** Customer-friendly summary safe for the admin UI. Never contains secrets. */
  summary: string;
  notes: string[];
  /** Optional small fingerprint of the response (for live-call results) so
   * the operator can confirm the call returned real data without leaking
   * giant payloads. */
  responseFingerprint?: Record<string, string | number | boolean | null>;
}

const PROVIDER_LABELS: Record<ForecastProvider, string> = {
  'open-meteo': 'Open-Meteo',
  'weathernext-bigquery-sample': 'WeatherNext (sample)',
  'weathernext-bigquery-production': 'WeatherNext (BigQuery production)',
  'weathernext-production': 'WeatherNext (Vertex AI)',
};

/** Hardcoded smoke-test location — Columbia, SC. Predefined so the
 *  operator can never inject arbitrary lat/lon from the UI. */
const SMOKE_LAT = 34.0007;
const SMOKE_LON = -81.0348;
const SMOKE_DAYS = 1;

// ── Per-provider tests ──────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; durationMs: number; error?: any }> {
  const start = Date.now();
  try {
    return { value: await fn(), durationMs: Date.now() - start };
  } catch (error: any) {
    return { error, durationMs: Date.now() - start };
  }
}

function fpFromForecast(provider: ForecastProvider, forecast: unknown): Record<string, string | number | boolean | null> {
  const f: any = forecast;
  return {
    provider,
    hasCurrent: !!f?.current,
    hasHourly: Array.isArray(f?.hourly),
    hourlyLength: Array.isArray(f?.hourly) ? f.hourly.length : 0,
    hasDaily: Array.isArray(f?.daily),
    dailyLength: Array.isArray(f?.daily) ? f.daily.length : 0,
    currentTempF: typeof f?.current?.tempF === 'number' ? Math.round(f.current.tempF) : null,
    generatedAt: typeof f?.generatedAt === 'string' ? f.generatedAt : null,
  };
}

async function smokeOpenMeteo(): Promise<SmokeTestResult> {
  const t = await timed(() => getOpenMeteoForecast(SMOKE_LAT, SMOKE_LON, SMOKE_DAYS));
  if (t.error || !t.value) {
    return {
      provider: 'open-meteo',
      label: PROVIDER_LABELS['open-meteo'],
      ok: false,
      status: 'live_call_failed',
      durationMs: t.durationMs,
      summary: `Open-Meteo smoke test failed: ${t.error?.message ?? 'unknown'}`,
      notes: [String(t.error?.message ?? 'unknown')],
    };
  }
  const fp = fpFromForecast('open-meteo', t.value);
  return {
    provider: 'open-meteo',
    label: PROVIDER_LABELS['open-meteo'],
    ok: true,
    status: 'live_call_ok',
    durationMs: t.durationMs,
    summary: `Open-Meteo returned ${fp.hourlyLength} hourly points; current ${fp.currentTempF}°F.`,
    notes: ['Live request to https://api.open-meteo.com/v1/forecast against Columbia, SC.'],
    responseFingerprint: fp,
  };
}

interface WeatherNextSmokeOptions {
  /** Set to `true` to actually attempt the Vertex AI call. Today this still
   *  returns failureMode=endpoint_unconfirmed; it's exposed so the operator
   *  can confirm the harness is wired up end-to-end. */
  attemptLiveCall?: boolean;
}

async function smokeWeatherNextVertex(opts: WeatherNextSmokeOptions): Promise<SmokeTestResult> {
  const start = Date.now();
  const readiness: WeatherNextReadiness = getWeatherNextReadiness();
  if (!readiness.contractConfirmed) {
    return {
      provider: 'weathernext-production',
      label: PROVIDER_LABELS['weathernext-production'],
      ok: false,
      status: 'contract_unconfirmed',
      durationMs: Date.now() - start,
      summary: 'WeatherNext (Vertex AI) contract not confirmed; smoke test is readiness-only.',
      notes: [
        readiness.statusLabel,
        readiness.missing.length > 0
          ? `Missing required env: ${readiness.missing.join(', ')}.`
          : 'All required env present.',
        'See docs/weathernext-contract-readiness.md.',
      ],
    };
  }
  if (!readiness.ready) {
    return {
      provider: 'weathernext-production',
      label: PROVIDER_LABELS['weathernext-production'],
      ok: false,
      status: 'unconfigured',
      durationMs: Date.now() - start,
      summary: `WeatherNext (Vertex AI) not configured: missing ${readiness.missing.join(', ')}.`,
      notes: [readiness.statusLabel],
    };
  }
  // Contract confirmed AND configured — attempt live call only when asked.
  if (!opts.attemptLiveCall) {
    return {
      provider: 'weathernext-production',
      label: PROVIDER_LABELS['weathernext-production'],
      ok: true,
      status: 'readiness_ok',
      durationMs: Date.now() - start,
      summary: 'WeatherNext (Vertex AI) ready; live call not attempted (use ?live=true).',
      notes: [readiness.statusLabel],
    };
  }
  // Lazy-import to avoid loading the client if no live call requested.
  const { tryWeatherNextForecast } = await import('./weathernext-client');
  const t = await timed(() => tryWeatherNextForecast(SMOKE_LAT, SMOKE_LON, SMOKE_DAYS));
  const result = t.value!;
  if (!t.error && result.ok) {
    const fp = fpFromForecast('weathernext-production', result.forecast);
    return {
      provider: 'weathernext-production',
      label: PROVIDER_LABELS['weathernext-production'],
      ok: true,
      status: 'live_call_ok',
      durationMs: t.durationMs,
      summary: `Vertex AI returned ${fp.hourlyLength} hourly points; current ${fp.currentTempF}°F.`,
      notes: result.notes,
      responseFingerprint: fp,
    };
  }
  const failure = result.ok ? null : result;
  return {
    provider: 'weathernext-production',
    label: PROVIDER_LABELS['weathernext-production'],
    ok: false,
    status: failure?.failureMode === 'endpoint_unconfirmed' ? 'contract_unconfirmed' : 'live_call_failed',
    durationMs: t.durationMs,
    summary: failure
      ? `Vertex AI smoke test failed: ${failure.failureMode}`
      : `Vertex AI smoke test threw: ${String(t.error?.message ?? t.error)}`,
    notes: failure ? failure.notes : [String(t.error?.message ?? t.error)],
  };
}

interface BigQuerySampleSmokeOptions {
  /** Operator must explicitly opt in to a live BigQuery query — otherwise
   *  the test is readiness-only. Avoids accidental query cost. */
  attemptLiveQuery?: boolean;
}

async function smokeWeatherNextBigQuerySample(opts: BigQuerySampleSmokeOptions): Promise<SmokeTestResult> {
  const start = Date.now();
  if (!opts.attemptLiveQuery) {
    return {
      provider: 'weathernext-bigquery-sample',
      label: PROVIDER_LABELS['weathernext-bigquery-sample'],
      ok: true,
      status: 'skipped',
      durationMs: Date.now() - start,
      summary:
        'WeatherNext (sample) live query not attempted; pass live=true to actually hit `bigquery-public-data.weathernext.sample`.',
      notes: [
        'The sample dataset is intentionally opt-in even for smoke tests because BigQuery queries cost real money per byte scanned.',
      ],
    };
  }
  const t = await timed(() => fetchBigQueryWeatherNextSample(SMOKE_LAT, SMOKE_LON, SMOKE_DAYS));
  if (t.error || !t.value) {
    return {
      provider: 'weathernext-bigquery-sample',
      label: PROVIDER_LABELS['weathernext-bigquery-sample'],
      ok: false,
      status: 'live_call_failed',
      durationMs: t.durationMs,
      summary: `WeatherNext (sample) live query failed: ${t.error?.message ?? 'unknown'}`,
      notes: [String(t.error?.message ?? 'unknown')],
    };
  }
  const fp = fpFromForecast('weathernext-bigquery-sample', t.value);
  return {
    provider: 'weathernext-bigquery-sample',
    label: PROVIDER_LABELS['weathernext-bigquery-sample'],
    ok: true,
    status: 'live_call_ok',
    durationMs: t.durationMs,
    summary: `WeatherNext (sample) returned ${fp.hourlyLength} hourly points; current ${fp.currentTempF}°F.`,
    notes: [
      'Live query against `bigquery-public-data.weathernext.sample`.',
      'Sample dataset is research-only; UV / precip-probability / visibility are fabricated by the legacy normalizer.',
    ],
    responseFingerprint: fp,
  };
}

async function smokeWeatherNextBigQueryProduction(): Promise<SmokeTestResult> {
  const start = Date.now();
  const readiness: WeatherNextBigQueryReadiness = getWeatherNextBigQueryReadiness();
  if (!readiness.contractConfirmed) {
    return {
      provider: 'weathernext-bigquery-production',
      label: PROVIDER_LABELS['weathernext-bigquery-production'],
      ok: false,
      status: 'contract_unconfirmed',
      durationMs: Date.now() - start,
      summary:
        'WeatherNext (BigQuery production) dataset/table/schema not confirmed; smoke test is readiness-only.',
      notes: [
        readiness.statusLabel,
        readiness.missing.length > 0
          ? `Missing required env: ${readiness.missing.join(', ')}.`
          : 'All required env present.',
        'See docs/weathernext-contract-readiness.md.',
      ],
    };
  }
  if (!readiness.ready) {
    return {
      provider: 'weathernext-bigquery-production',
      label: PROVIDER_LABELS['weathernext-bigquery-production'],
      ok: false,
      status: 'unconfigured',
      durationMs: Date.now() - start,
      summary: `WeatherNext (BigQuery production) not configured: missing ${readiness.missing.join(', ')}.`,
      notes: [readiness.statusLabel],
    };
  }
  return {
    provider: 'weathernext-bigquery-production',
    label: PROVIDER_LABELS['weathernext-bigquery-production'],
    ok: true,
    status: 'readiness_ok',
    durationMs: Date.now() - start,
    summary:
      'WeatherNext (BigQuery production) ready; live query not implemented (Step 143+ work).',
    notes: [readiness.statusLabel],
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export const SMOKE_TEST_PROVIDERS: ForecastProvider[] = [
  'open-meteo',
  'weathernext-production',
  'weathernext-bigquery-sample',
  'weathernext-bigquery-production',
];

export interface RunSmokeTestOptions {
  /** Operator opt-in for the BigQuery sample live query. Defaults `false`. */
  attemptLiveQuery?: boolean;
  /** Operator opt-in for a Vertex AI live call. Defaults `false`. */
  attemptLiveCall?: boolean;
}

export async function runForecastProviderSmokeTest(
  provider: ForecastProvider,
  options: RunSmokeTestOptions = {},
): Promise<SmokeTestResult> {
  switch (provider) {
    case 'open-meteo':
      return smokeOpenMeteo();
    case 'weathernext-production':
      return smokeWeatherNextVertex({ attemptLiveCall: !!options.attemptLiveCall });
    case 'weathernext-bigquery-sample':
      return smokeWeatherNextBigQuerySample({ attemptLiveQuery: !!options.attemptLiveQuery });
    case 'weathernext-bigquery-production':
      return smokeWeatherNextBigQueryProduction();
  }
}

/**
 * List the providers the smoke-test harness knows about, with their
 * current readiness status — no live calls. Cheap; safe to call on
 * every admin page render.
 */
export function listProviderSmokeTestStatuses(): Array<{
  provider: ForecastProvider;
  label: string;
  /** True when the provider has at least one path that could succeed today. */
  liveCallAvailable: boolean;
  /** Free-text status, no secrets. */
  statusLabel: string;
}> {
  const wnReadiness = getWeatherNextReadiness();
  const bqReadiness = getWeatherNextBigQueryReadiness();
  return [
    {
      provider: 'open-meteo',
      label: PROVIDER_LABELS['open-meteo'],
      liveCallAvailable: true,
      statusLabel: 'Live call available — no auth required.',
    },
    {
      provider: 'weathernext-production',
      label: PROVIDER_LABELS['weathernext-production'],
      liveCallAvailable: wnReadiness.ready,
      statusLabel: wnReadiness.statusLabel,
    },
    {
      provider: 'weathernext-bigquery-sample',
      label: PROVIDER_LABELS['weathernext-bigquery-sample'],
      liveCallAvailable: true, // configured globally; query costs real money
      statusLabel:
        'Live query available (opt-in only — BigQuery queries cost real money per byte scanned).',
    },
    {
      provider: 'weathernext-bigquery-production',
      label: PROVIDER_LABELS['weathernext-bigquery-production'],
      liveCallAvailable: bqReadiness.ready,
      statusLabel: bqReadiness.statusLabel,
    },
  ];
}
