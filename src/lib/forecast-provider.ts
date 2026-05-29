// ── Step 170: Forecast provider adapter foundation ──────────────────────
//
// **Additive, additive, additive.** This module formalizes the
// forecast-provider contract the Step 170 spec asks for without
// changing the existing `weather-queries.getForecast()` dispatch, the
// existing `forecast-source.ts` resolver, or any public forecast page.
// The ZIP-code experience on `wageronweather.com` is unchanged.
//
// What this module provides:
//
//   - A typed `ForecastProviderAdapter` interface (spec Task 2).
//   - Adapters for `openmeteo` (default, ready) and `weathernext` (shell,
//     disabled-by-default, fail-graceful).
//   - Provider-selection helpers that read the new env vars (spec
//     Task 4) and fall back to the existing `forecast-source` posture.
//   - Env-flag gating helpers consumed by the existing WeatherNext
//     clients so the spec's `WEATHER_PROVIDER_WEATHERNEXT_ENABLED`
//     defensive kill-switch is honored from a single place.
//
// What this module does NOT do:
//
//   - Replace the existing `forecast-source.ts` slugs
//     (`open-meteo | weathernext-bigquery-sample |
//      weathernext-bigquery-production | weathernext-production`).
//     Those continue to drive the live `weather-queries.getForecast()`
//     dispatch. Step 170's `ProviderId` is a coarser surface layered
//     above the existing slugs.
//   - Change the public forecast page, ZIP-code lookup, public API
//     routes, or any market behavior (publishing / pricing /
//     settlement / grading).
//   - Activate WeatherNext anywhere by default.

import { getOpenMeteoForecast } from './open-meteo';
import {
  tryWeatherNextForecast,
  getWeatherNextConfigStatus,
} from './weathernext-client';
import {
  resolveForecastProvider,
  type ForecastProvider as LegacyForecastProvider,
} from './forecast-source';
import type { ForecastResponse } from './types';

if (typeof window !== 'undefined') {
  // Defensive — the adapter layer touches process.env / Vertex AI helpers.
  // Callers should be server-side only.
  // (Existing client-only callers continue to use `getForecast` from
  // `weather-queries.ts` which already throws on browser import.)
}

// ── Public types ────────────────────────────────────────────────────────────

/** Step 170 spec id surface — coarser than the legacy `ForecastProvider`. */
export type ProviderId = 'openmeteo' | 'weathernext';

/** Common interface every provider implements. */
export interface ForecastProviderAdapter {
  /** Stable id used by env-var selection + audit. */
  providerId: ProviderId;
  /** User-facing label. */
  label: string;
  /** True when the provider supports direct ZIP-code resolution. */
  supportsZipForecast: boolean;
  /**
   * Resolve a forecast directly from a zip code. **Not implemented by
   * the current providers** — ZIP → lat/lon happens upstream in
   * `zip-lookup.ts` and the resolved coords are handed to
   * `fetchForecastByLatLon`. Kept on the interface so a future
   * provider with native ZIP support (e.g. a future WeatherNext
   * endpoint) can plug in without an interface widening.
   */
  fetchForecastByZip?(
    zip: string,
    countryCode?: string,
    days?: number,
  ): Promise<ProviderForecastResult>;
  /** Resolve a forecast by lat/lon. **Never throws** — every error path is mapped to `unavailable`. */
  fetchForecastByLatLon(
    lat: number,
    lon: number,
    days?: number,
  ): Promise<ProviderForecastResult>;
}

export type ProviderForecastResult =
  | { ok: true; forecast: ForecastResponse }
  | { ok: false; reason: ProviderUnavailableReason; notes?: string[] };

export type ProviderUnavailableReason =
  | 'feature_flag_disabled'
  | 'unconfigured'
  | 'endpoint_unconfirmed'
  | 'upstream_failure'
  | 'unknown';

// ── Env reader (mirrors forecast-source / weathernext-client) ──────────────

function readEnv(name: string): string | undefined {
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

function isFlagTrue(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

// ── WeatherNext feature flag (defensive kill switch) ───────────────────────

/**
 * **Defensive kill switch consumed by the existing WeatherNext clients.**
 *
 * Even when `FORECAST_PROVIDER=weathernext-production` (or any other
 * WeatherNext slug) is set, the WeatherNext client should bail out
 * with `feature_flag_disabled` unless this env var is explicitly
 * `true` / `1` / `yes` / `on`.
 *
 * Default: **false**. The public ZIP-code forecast experience continues
 * to be served by Open-Meteo until a deliberate operator action sets
 * the flag.
 */
export function isWeatherNextFeatureEnabled(): boolean {
  return isFlagTrue(readEnv('WEATHER_PROVIDER_WEATHERNEXT_ENABLED'));
}

// ── Provider selection (Step 170 env vars) ─────────────────────────────────

function parseProviderId(raw: string | undefined): ProviderId | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'openmeteo' || v === 'open-meteo' || v === 'open_meteo') return 'openmeteo';
  if (v === 'weathernext' || v === 'weather-next' || v === 'weather_next') return 'weathernext';
  return null;
}

/**
 * Public-surface provider. **Defaults to `openmeteo`.** Consumed by
 * any caller that wants to know which provider the public forecast
 * pages should be ready to surface as a label.
 */
export function getPublicForecastProvider(): ProviderId {
  return parseProviderId(readEnv('PUBLIC_FORECAST_PROVIDER')) ?? 'openmeteo';
}

/**
 * Admin-intelligence provider. **No default.** When unset, callers
 * should treat the intelligence layer as Open-Meteo as well — i.e. no
 * cross-provider comparison happens until the operator opts in.
 */
export function getIntelligenceForecastProvider(): ProviderId | null {
  return parseProviderId(readEnv('WEATHER_INTELLIGENCE_PROVIDER'));
}

/** Fallback provider when the primary one is unavailable. **Defaults to `openmeteo`.** */
export function getFallbackForecastProvider(): ProviderId {
  return parseProviderId(readEnv('FALLBACK_FORECAST_PROVIDER')) ?? 'openmeteo';
}

// ── Adapter implementations ────────────────────────────────────────────────

/** Pure Open-Meteo adapter — thin wrapper over the existing client. */
const openMeteoAdapter: ForecastProviderAdapter = {
  providerId: 'openmeteo',
  label: 'Open-Meteo',
  supportsZipForecast: false,
  async fetchForecastByLatLon(lat, lon, days = 15) {
    try {
      const forecast = await getOpenMeteoForecast(lat, lon, days);
      return { ok: true, forecast };
    } catch (err: any) {
      return {
        ok: false,
        reason: 'upstream_failure',
        notes: [err?.message ?? String(err)],
      };
    }
  },
};

/**
 * WeatherNext adapter shell — disabled-by-default. The internal call
 * goes through `tryWeatherNextForecast` which already has its own
 * fail-graceful contract; the adapter mainly enforces the new
 * `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` kill-switch *before* the
 * upstream client is even invoked.
 */
const weatherNextAdapter: ForecastProviderAdapter = {
  providerId: 'weathernext',
  label: 'WeatherNext',
  supportsZipForecast: false,
  async fetchForecastByLatLon(lat, lon, days = 15) {
    if (!isWeatherNextFeatureEnabled()) {
      return {
        ok: false,
        reason: 'feature_flag_disabled',
        notes: [
          'WEATHER_PROVIDER_WEATHERNEXT_ENABLED is not "true" — WeatherNext attempts are disabled. ' +
            'Set the flag explicitly to opt in.',
        ],
      };
    }
    const cfg = getWeatherNextConfigStatus();
    if (!cfg.ready) {
      return {
        ok: false,
        reason: 'unconfigured',
        notes: [
          'WeatherNext Vertex AI config is incomplete. Check GCP_PROJECT_ID / GCP_CREDENTIALS_BASE64 / WEATHERNEXT_VERTEX_REGION / WEATHERNEXT_VERTEX_ENDPOINT_ID.',
        ],
      };
    }
    const result = await tryWeatherNextForecast(lat, lon, days);
    if (result.ok) {
      return { ok: true, forecast: result.forecast };
    }
    // Map upstream failure modes onto the Step 170 reason vocabulary.
    let reason: ProviderUnavailableReason;
    if (result.failureMode === 'endpoint_unconfirmed') reason = 'endpoint_unconfirmed';
    else if (result.failureMode === 'unconfigured') reason = 'unconfigured';
    else reason = 'upstream_failure';
    return { ok: false, reason, notes: result.notes };
  },
};

// ── Public registry ───────────────────────────────────────────────────────

/** Return the adapter for a provider id. Pure lookup; never throws. */
export function getProviderAdapter(id: ProviderId): ForecastProviderAdapter {
  if (id === 'weathernext') return weatherNextAdapter;
  return openMeteoAdapter;
}

/** List every registered adapter (in deterministic order). */
export function listProviderAdapters(): readonly ForecastProviderAdapter[] {
  return [openMeteoAdapter, weatherNextAdapter];
}

// ── Bridge to the legacy ForecastProvider slug surface ────────────────────

/**
 * Map a Step 170 `ProviderId` back onto the existing
 * `forecast-source.ForecastProvider` slug union so callers that need
 * to populate `ForecastResponse.source` (which still uses the legacy
 * slug surface) don't have to reinvent the mapping.
 */
export function providerIdToLegacySlug(id: ProviderId): LegacyForecastProvider {
  if (id === 'weathernext') return 'weathernext-production';
  return 'open-meteo';
}

/**
 * Coarse status summary for an admin debug surface. **Read-only.**
 * Includes the new env-flag posture so an admin can verify the
 * defaults are intact at runtime.
 */
export interface ProviderFoundationStatus {
  publicProvider: ProviderId;
  intelligenceProvider: ProviderId | null;
  fallbackProvider: ProviderId;
  weatherNextFeatureEnabled: boolean;
  weatherNextConfigReady: boolean;
  legacyResolvedProvider: LegacyForecastProvider;
}

export function getProviderFoundationStatus(): ProviderFoundationStatus {
  return {
    publicProvider: getPublicForecastProvider(),
    intelligenceProvider: getIntelligenceForecastProvider(),
    fallbackProvider: getFallbackForecastProvider(),
    weatherNextFeatureEnabled: isWeatherNextFeatureEnabled(),
    weatherNextConfigReady: getWeatherNextConfigStatus().ready,
    legacyResolvedProvider: resolveForecastProvider(),
  };
}
