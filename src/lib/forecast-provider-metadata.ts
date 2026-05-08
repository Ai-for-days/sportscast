// ── Step 134: Forecast provider capability metadata ─────────────────────────
//
// Central, pure-data registry of what each forecast provider can and can't
// do. Used by admin diagnostics, by the Step 133 source label, and (Step
// 135 onward) by the Vertex AI client to know which fields are first-class
// vs. derived. No network calls, no auth, no secrets — just metadata.
//
// Keep in sync with docs/forecast-provider-capabilities.md.
//
// Settlement boundary: none of these providers are on the settlement path.
// Markets resolve via src/lib/nws-grading.ts / src/lib/nws-observations.ts.

import type { ForecastProvider } from './forecast-source';

export type FieldQuality = 'real' | 'derived' | 'fabricated' | 'absent';

export interface ForecastProviderFieldSupport {
  temperature: FieldQuality;
  humidity: FieldQuality;
  dewPoint: FieldQuality;
  precipitationAmount: FieldQuality;
  precipitationProbability: FieldQuality;
  windSpeed: FieldQuality;
  windDirection: FieldQuality;
  windGust: FieldQuality;
  cloudCover: FieldQuality;
  surfacePressure: FieldQuality;
  apparentTemperature: FieldQuality;
  uvIndex: FieldQuality;
  visibility: FieldQuality;
  weatherCode: FieldQuality;
}

export interface ForecastProviderCapabilities {
  provider: ForecastProvider;
  /** Customer-friendly label, mirrors `ForecastSource.label`. */
  label: string;
  /** "hourly" / "six-hourly" / "daily-ish". Coarse, not a number. */
  expectedUpdateCadence: 'hourly' | 'six-hourly' | 'daily-ish';
  /** Maximum forecast horizon in days, approximate. */
  forecastHorizonDays: number;
  /** Approximate native grid spacing, free-text. */
  geographicResolution: string;
  /** Whether the provider exposes per-hour forecast points. */
  supportsHourly: boolean;
  /** Real precipitation probability (not derived from precipMm). */
  supportsPrecipitationProbability: boolean;
  /** Real wind gust (not derived from wind speed). */
  supportsWindGusts: boolean;
  /** Real visibility (not hardcoded). */
  supportsVisibility: boolean;
  /** Real UV index (not hardcoded). */
  supportsUvIndex: boolean;
  /** Per-field support breakdown. */
  fields: ForecastProviderFieldSupport;
  /** What the provider is intended for in this codebase. */
  intendedUsage:
    | 'public-default'
    | 'research-only'
    | 'planned-strategic'
    | 'planned-fallback';
  /** Whether this provider is wired up and trusted for live customer pages. */
  productionReady: boolean;
  /** Free-text note for admin debug surfaces. */
  notes: string;
}

const ALL_REAL: ForecastProviderFieldSupport = {
  temperature: 'real',
  humidity: 'real',
  dewPoint: 'real',
  precipitationAmount: 'real',
  precipitationProbability: 'real',
  windSpeed: 'real',
  windDirection: 'real',
  windGust: 'real',
  cloudCover: 'real',
  surfacePressure: 'real',
  apparentTemperature: 'real',
  uvIndex: 'real',
  visibility: 'real',
  weatherCode: 'real',
};

const SAMPLE_FIELDS: ForecastProviderFieldSupport = {
  temperature: 'real',
  humidity: 'real',
  dewPoint: 'derived',
  precipitationAmount: 'real',
  precipitationProbability: 'fabricated',
  windSpeed: 'real',
  windDirection: 'real',
  windGust: 'fabricated',
  cloudCover: 'real',
  surfacePressure: 'real',
  apparentTemperature: 'derived',
  uvIndex: 'fabricated',
  visibility: 'fabricated',
  weatherCode: 'derived',
};

export const FORECAST_PROVIDER_CAPABILITIES: Record<
  ForecastProvider,
  ForecastProviderCapabilities
> = {
  'open-meteo': {
    provider: 'open-meteo',
    label: 'Open-Meteo',
    expectedUpdateCadence: 'hourly',
    forecastHorizonDays: 16,
    geographicResolution: '0.05–0.25° (model dependent; ECMWF IFS + GFS + HRRR + ICON blend)',
    supportsHourly: true,
    supportsPrecipitationProbability: true,
    supportsWindGusts: true,
    supportsVisibility: true,
    supportsUvIndex: true,
    fields: ALL_REAL,
    intendedUsage: 'public-default',
    productionReady: true,
    notes:
      'Current safe default. Real values for every UI field. Hourly refresh. Same model blend powering weather.com under the hood.',
  },
  'weathernext-bigquery-sample': {
    provider: 'weathernext-bigquery-sample',
    label: 'WeatherNext (sample)',
    expectedUpdateCadence: 'daily-ish',
    forecastHorizonDays: 10,
    geographicResolution: '~0.25° (downsampled public sample)',
    supportsHourly: true,
    supportsPrecipitationProbability: false,
    supportsWindGusts: false,
    supportsVisibility: false,
    supportsUvIndex: false,
    fields: SAMPLE_FIELDS,
    intendedUsage: 'research-only',
    productionReady: false,
    notes:
      'Research / A-B preview only. The public sample dataset on `bigquery-public-data.weathernext.sample` is downsampled and missing several UI fields, which were filled with formulaic placeholders by the legacy code. Never serve as the public default.',
  },
  'weathernext-production': {
    provider: 'weathernext-production',
    label: 'WeatherNext',
    expectedUpdateCadence: 'six-hourly',
    forecastHorizonDays: 10,
    geographicResolution: 'native model resolution (TBD against published Vertex AI / BigQuery production schema)',
    supportsHourly: true,
    supportsPrecipitationProbability: true,
    supportsWindGusts: true,
    supportsVisibility: true,
    supportsUvIndex: true,
    fields: ALL_REAL,
    intendedUsage: 'planned-strategic',
    productionReady: false,
    notes:
      'Strategic preferred source. Vertex AI is the recommended primary access path; BigQuery production tables are the fallback. Earth Engine is reserved for future spatial analytics. Not yet wired up — requesting this mode today logs a warning in `forecast-source.ts` and serves Open-Meteo. See `docs/weathernext-integration-plan.md`.',
  },
};

/** Look up the capability record for a provider. */
export function getForecastProviderCapabilities(
  provider: ForecastProvider,
): ForecastProviderCapabilities {
  return FORECAST_PROVIDER_CAPABILITIES[provider];
}

/** True when the provider can be used as the live customer-facing default. */
export function isProviderProductionReady(provider: ForecastProvider): boolean {
  return FORECAST_PROVIDER_CAPABILITIES[provider].productionReady;
}
