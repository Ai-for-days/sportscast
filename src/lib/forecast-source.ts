// ── Step 133: Forecast source resolver ──────────────────────────────────────
//
// Single source of truth for which forecast provider the public weather
// pages render. Strategic posture (see docs/weathernext-integration-plan.md):
//
//   - "open-meteo" (default + only supported live source)
//       Blends ECMWF IFS + GFS + HRRR + ICON, refreshed hourly. Returns
//       real precipitation_probability, uv_index, visibility, gusts.
//       Same gold-standard models powering weather.com under the hood.
//
//   - "weathernext-bigquery-sample"
//       Google's `bigquery-public-data.weathernext.sample`. RESEARCH /
//       A-B PREVIEW ONLY — downsampled, ~daily updates, fabricates
//       UV / precip-probability / visibility on the way through. Never
//       the default. Opt-in only.
//
//   - "weathernext-production"
//       Stub. WagerOnWeather's strategic preferred source (see plan).
//       Until production-quality access (Vertex AI, BigQuery production
//       WeatherNext tables, or Earth Engine) is wired up and validated,
//       requesting this mode logs a clear warning and falls back to
//       Open-Meteo. Never silently lands on the public sample.
//
// Settlement / grading does NOT use this module. Markets resolve via
// nws-grading.ts / nws-observations.ts (or whatever official observation
// pathway is configured). The forecast source only affects what users see
// on the public weather page and the Step 129–132 intelligence layer.

export type ForecastProvider =
  | 'open-meteo'
  | 'weathernext-bigquery-sample'
  | 'weathernext-production';

export interface ForecastSource {
  provider: ForecastProvider;
  /** Short user-facing label, e.g. "Open-Meteo" or "WeatherNext (sample)". */
  label: string;
  /** True when the source is a research / preview dataset, not production. */
  isResearchSample: boolean;
  /** Free-text note suitable for admin debug surfaces. */
  notes?: string;
}

const OPEN_METEO_SOURCE: ForecastSource = {
  provider: 'open-meteo',
  label: 'Open-Meteo',
  isResearchSample: false,
  notes:
    'Default. Blends ECMWF IFS + GFS + HRRR + ICON. Hourly updates. Real UV / precip-probability / visibility / gusts.',
};

const WEATHERNEXT_SAMPLE_SOURCE: ForecastSource = {
  provider: 'weathernext-bigquery-sample',
  label: 'WeatherNext (sample)',
  isResearchSample: true,
  notes:
    'Google `bigquery-public-data.weathernext.sample`. Research/A-B preview only — downsampled, ~daily updates, fabricates UV / precip-probability / visibility. Opt-in via FORECAST_PROVIDER=weathernext-bigquery-sample (or legacy USE_BIGQUERY_FORECAST=true).',
};

const WEATHERNEXT_PRODUCTION_STUB_SOURCE: ForecastSource = {
  provider: 'open-meteo',
  label: 'Open-Meteo (WeatherNext production stub fell back)',
  isResearchSample: false,
  notes:
    'FORECAST_PROVIDER=weathernext-production is the strategic target but production WeatherNext access is not yet wired up. Falling back to Open-Meteo. See docs/weathernext-integration-plan.md.',
};

const WEATHERNEXT_PRODUCTION_SOURCE: ForecastSource = {
  provider: 'weathernext-production',
  label: 'WeatherNext',
  isResearchSample: false,
  notes:
    'Google DeepMind WeatherNext via Vertex AI. Production-grade strategic source.',
};

function readEnv(name: string): string | undefined {
  // Astro / Vite expose env via import.meta.env at build/SSR time, and Node
  // exposes the same names via process.env at runtime. Read both to keep
  // the resolver portable across server entry points.
  const fromVite =
    typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env[name];
  if (typeof fromVite === 'string' && fromVite.length > 0) return fromVite;
  if (typeof process !== 'undefined' && process.env) {
    const v = process.env[name];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function parseProvider(raw: string | undefined): ForecastProvider | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'open-meteo') return 'open-meteo';
  if (v === 'weathernext-bigquery-sample') return 'weathernext-bigquery-sample';
  if (v === 'weathernext-production') return 'weathernext-production';
  return null;
}

/**
 * Resolve the active forecast provider from env.
 *
 * Priority:
 *   1. FORECAST_PROVIDER (explicit, preferred).
 *   2. Legacy USE_BIGQUERY_FORECAST=true → weathernext-bigquery-sample.
 *   3. Default → open-meteo.
 *
 * Unknown FORECAST_PROVIDER values fall back to open-meteo with a warning.
 */
export function resolveForecastProvider(): ForecastProvider {
  const explicit = readEnv('FORECAST_PROVIDER');
  if (explicit) {
    const parsed = parseProvider(explicit);
    if (parsed) return parsed;
    console.warn(
      `[forecast-source] FORECAST_PROVIDER="${explicit}" is not recognized — falling back to open-meteo. ` +
        `Valid values: open-meteo | weathernext-bigquery-sample | weathernext-production.`,
    );
    return 'open-meteo';
  }

  // Legacy flag from the Step 132 follow-up. Treat as the sample/research
  // path so existing deployments don't silently re-promote the public
  // sample table to the default position.
  const legacy = readEnv('USE_BIGQUERY_FORECAST');
  if (legacy && legacy.trim().toLowerCase() === 'true') {
    return 'weathernext-bigquery-sample';
  }

  return 'open-meteo';
}

/**
 * Build the ForecastSource record that should ride along with a forecast
 * response. For `weathernext-production` this returns the open-meteo stub
 * source so callers automatically render the fallback correctly — and
 * logs a warning so it's visible in admin/server logs.
 */
export function getForecastSource(provider: ForecastProvider): ForecastSource {
  if (provider === 'open-meteo') return OPEN_METEO_SOURCE;
  if (provider === 'weathernext-bigquery-sample') {
    console.warn(
      '[forecast-source] Serving the WeatherNext BigQuery sample dataset — research/preview only. ' +
        'See docs/weathernext-integration-plan.md.',
    );
    return WEATHERNEXT_SAMPLE_SOURCE;
  }
  // weathernext-production stub
  console.warn(
    '[forecast-source] FORECAST_PROVIDER=weathernext-production requested but production WeatherNext access ' +
      'is not implemented in this build — falling back to Open-Meteo. ' +
      'See docs/weathernext-integration-plan.md for the integration roadmap.',
  );
  return WEATHERNEXT_PRODUCTION_STUB_SOURCE;
}

/**
 * True when the resolved provider should physically execute the BigQuery
 * sample path. Centralizes the legacy / new-flag mapping so callers don't
 * have to know about both.
 */
export function shouldExecuteBigQuerySample(provider: ForecastProvider): boolean {
  return provider === 'weathernext-bigquery-sample';
}

// ── Step 135 helpers ────────────────────────────────────────────────────────
//
// Step 133's `getForecastSource('weathernext-production')` is a stub that
// returns the Open-Meteo fallback source. With Step 135's safe Vertex AI
// client harness, we now have two distinct outcomes for that provider:
// success and fallback. The helpers below let `weather-queries.ts` build
// the right source object for whichever path the request actually took,
// without touching the legacy stub callers.

/**
 * The "we successfully reached production WeatherNext via Vertex AI"
 * source. To be attached to a ForecastResponse only when the
 * `weathernext-client` returned `ok: true`.
 */
export function getWeatherNextSuccessSource(): ForecastSource {
  return WEATHERNEXT_PRODUCTION_SOURCE;
}

/**
 * The "we requested WeatherNext production but had to serve Open-Meteo
 * instead" source. The `failureMode` and `extraNotes` describe why.
 * Surfaced to admin debug surfaces; the customer just sees the Open-Meteo
 * label in the Step 133 source line.
 */
export function getWeatherNextFallbackSource(
  failureMode: string,
  extraNotes: string[] = [],
): ForecastSource {
  const noteParts = [
    `FORECAST_PROVIDER=weathernext-production fell back to Open-Meteo (failureMode=${failureMode}).`,
    ...extraNotes,
  ];
  return {
    provider: 'open-meteo',
    label: 'Open-Meteo',
    isResearchSample: false,
    notes: noteParts.join(' '),
  };
}
