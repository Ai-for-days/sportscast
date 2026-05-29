// ── Step 135: WeatherNext Vertex AI client (server-only, foundation) ────────
//
// Safe spike of the Vertex AI access path recommended in
// docs/weathernext-decision-matrix.md. This module is the harness:
//
//   - Typed result shape (`WeatherNextResult`) so callers always know
//     whether they got real data, a fallback signal, or a failure mode.
//   - 1500 ms hard timeout via AbortController.
//   - Every error path is captured as a structured failure mode — the
//     function never throws into the page render.
//   - Disabled by default. Even when `FORECAST_PROVIDER=weathernext-production`
//     is set, the call only attempts when the required Vertex AI config
//     is present in env. Otherwise it returns `failureMode: 'unconfigured'`.
//
// HONEST STATUS: the actual HTTP request body / response parsing is **not
// wired up in this build**. The exact Vertex AI endpoint name, model ID,
// request shape, and response schema for production WeatherNext could not
// be confirmed against authoritative Google docs at Step 135 time. The
// happy-path branch returns `failureMode: 'endpoint_unconfirmed'` so the
// resolver always lands on the safe Open-Meteo fallback. See
// docs/weathernext-integration-plan.md §10 for the unknowns that must be
// confirmed before the inference call can be implemented.
//
// Same trust posture as `kalshi-client.ts` / `polymarket-client.ts`:
// browser-import throws; credentials never leave the server; nothing in
// this module ever touches `nws-grading.ts` or `nws-observations.ts`.

import type { ForecastResponse } from './types';

if (typeof window !== 'undefined') {
  throw new Error(
    'weathernext-client is server-only and must not be imported in client code',
  );
}

// ── Failure mode taxonomy ───────────────────────────────────────────────────

export type WeatherNextFailureMode =
  /** Required Vertex AI config (project / region / endpoint id / credentials) is missing. */
  | 'unconfigured'
  /** Vertex AI inference body is not yet implemented in this build (Step 135 spike). */
  | 'endpoint_unconfirmed'
  /** Step 170 — `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` is not true. */
  | 'feature_flag_disabled'
  /** AbortController fired before the request returned. */
  | 'timeout'
  /** Network-level error (DNS, TLS, dropped connection). */
  | 'network_error'
  /** HTTP 401 / 403 — auth rejected. */
  | 'auth_rejected'
  /** HTTP 429 — quota exceeded. */
  | 'quota_exceeded'
  /** HTTP 5xx or other upstream error. */
  | 'upstream_error'
  /** Response shape didn't match the expected schema. */
  | 'schema_mismatch'
  /** Anything else not classified above. */
  | 'unknown';

// ── Result shape ────────────────────────────────────────────────────────────

export interface WeatherNextSuccess {
  ok: true;
  forecast: ForecastResponse;
  notes: string[];
}

export interface WeatherNextFailure {
  ok: false;
  failureMode: WeatherNextFailureMode;
  /** Human-readable structured notes — safe to log or surface to admin. */
  notes: string[];
  /** HTTP status when applicable (0 for client-side failures). */
  httpStatus?: number;
}

export type WeatherNextResult = WeatherNextSuccess | WeatherNextFailure;

// ── Config ──────────────────────────────────────────────────────────────────

export interface WeatherNextConfigStatus {
  /** `GCP_PROJECT_ID` is present. */
  hasProjectId: boolean;
  /** `GCP_CREDENTIALS_BASE64` is present. */
  hasCredentials: boolean;
  /** `WEATHERNEXT_VERTEX_REGION` is present. */
  hasRegion: boolean;
  /** `WEATHERNEXT_VERTEX_ENDPOINT_ID` is present. */
  hasEndpointId: boolean;
  /** `WEATHERNEXT_VERTEX_MODEL_ID` is present (optional — may be implied by endpoint). */
  hasModelId: boolean;
  /** True when the minimum config to attempt a call is in place. */
  ready: boolean;
}

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

/**
 * Server-only diagnostics helper. Returns booleans for each piece of
 * Vertex AI config without ever returning the values themselves. Safe to
 * call from a future admin debug surface; safe to log.
 */
export function getWeatherNextConfigStatus(): WeatherNextConfigStatus {
  const hasProjectId = !!readEnv('GCP_PROJECT_ID');
  const hasCredentials = !!readEnv('GCP_CREDENTIALS_BASE64');
  const hasRegion = !!readEnv('WEATHERNEXT_VERTEX_REGION');
  const hasEndpointId = !!readEnv('WEATHERNEXT_VERTEX_ENDPOINT_ID');
  const hasModelId = !!readEnv('WEATHERNEXT_VERTEX_MODEL_ID');
  // Minimum: project + creds + region + endpoint id. Model id is optional
  // because some Vertex AI endpoints embed the model id in the endpoint.
  const ready = hasProjectId && hasCredentials && hasRegion && hasEndpointId;
  return {
    hasProjectId,
    hasCredentials,
    hasRegion,
    hasEndpointId,
    hasModelId,
    ready,
  };
}

export function isWeatherNextConfigured(): boolean {
  return getWeatherNextConfigStatus().ready;
}

// ── Timeout helper ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 1500;

interface TimeoutHandles {
  signal: AbortSignal;
  cancel: () => void;
  /** True when the abort fired due to timeout. */
  didTimeout: () => boolean;
}

function withTimeout(timeoutMs: number): TimeoutHandles {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
    didTimeout: () => timedOut,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

export interface TryWeatherNextOptions {
  /** Hard timeout in ms. Defaults to 1500. */
  timeoutMs?: number;
}

/**
 * Attempt to fetch a normalized forecast from production WeatherNext via
 * Vertex AI. **Never throws** — every error path is classified as a
 * `WeatherNextFailure`. Caller must check `result.ok` and fall back to
 * the safe default (Open-Meteo) on failure.
 *
 * STATUS: skeleton only. Endpoint contract not yet confirmed against
 * Google docs — see docs/weathernext-integration-plan.md §10. The
 * function therefore returns `failureMode: 'endpoint_unconfirmed'` even
 * when fully configured, so the resolver always serves Open-Meteo until
 * the actual inference body is wired up.
 */
export async function tryWeatherNextForecast(
  lat: number,
  lon: number,
  days: number,
  options: TryWeatherNextOptions = {},
): Promise<WeatherNextResult> {
  // Argument sanity. Bad input falls back rather than throwing.
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(days) ||
    days <= 0
  ) {
    return {
      ok: false,
      failureMode: 'unknown',
      notes: [`Invalid input: lat=${lat}, lon=${lon}, days=${days}`],
    };
  }

  // Step 170 — defensive feature-flag kill switch. Even when
  // `FORECAST_PROVIDER=weathernext-production` is set, no Vertex AI
  // call is attempted unless the operator has explicitly opted in via
  // `WEATHER_PROVIDER_WEATHERNEXT_ENABLED`. Read inline to avoid a
  // cyclic import with `forecast-provider.ts`.
  const flag = readEnv('WEATHER_PROVIDER_WEATHERNEXT_ENABLED');
  if (!flag || !['true', '1', 'yes', 'on'].includes(flag.trim().toLowerCase())) {
    return {
      ok: false,
      failureMode: 'feature_flag_disabled',
      notes: [
        'WEATHER_PROVIDER_WEATHERNEXT_ENABLED is not "true" — WeatherNext attempts are disabled by Step 170 safety posture.',
      ],
    };
  }

  const status = getWeatherNextConfigStatus();
  if (!status.ready) {
    const missing = [
      !status.hasProjectId && 'GCP_PROJECT_ID',
      !status.hasCredentials && 'GCP_CREDENTIALS_BASE64',
      !status.hasRegion && 'WEATHERNEXT_VERTEX_REGION',
      !status.hasEndpointId && 'WEATHERNEXT_VERTEX_ENDPOINT_ID',
    ].filter(Boolean);
    return {
      ok: false,
      failureMode: 'unconfigured',
      notes: [
        `WeatherNext Vertex AI is not configured. Missing env: ${missing.join(', ')}.`,
        'See docs/weathernext-integration-plan.md for the production setup checklist.',
      ],
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t = withTimeout(timeoutMs);

  try {
    // ── INFERENCE BODY — DELIBERATELY NOT IMPLEMENTED ──────────────────────
    //
    // The exact Vertex AI inference call for production WeatherNext —
    // endpoint URL shape, model id, request body schema, response schema —
    // could not be confirmed against authoritative Google docs at Step 135.
    // Implementing it from guesses would either silently degrade users to a
    // wrong-shape response (caught by `schema_mismatch`) or fail every call
    // with `upstream_error`. Both end up at the Open-Meteo fallback, but
    // the second is better than the first because it doesn't risk leaking
    // partial / mislabeled data into the public page.
    //
    // When ready, the body should:
    //   1. Sign a Vertex AI request using GCP_CREDENTIALS_BASE64 (service
    //      account → Bearer token via google-auth-library or equivalent).
    //   2. POST to the model's `:predict` endpoint in the configured region
    //      (`https://${region}-aiplatform.googleapis.com/v1/projects/`
    //      `${projectId}/locations/${region}/endpoints/${endpointId}:predict`).
    //   3. Parse the response into a normalized `ForecastResponse`,
    //      consulting `forecast-provider-metadata.ts` for which fields are
    //      first-class vs. derived.
    //   4. Return `{ ok: true, forecast, notes }` with `forecast.source`
    //      populated by the caller (see weather-queries.ts).
    //
    // Until then:
    return {
      ok: false,
      failureMode: 'endpoint_unconfirmed',
      notes: [
        'WeatherNext Vertex AI client is wired up structurally but the inference body is not implemented.',
        'Endpoint contract must be confirmed against current Google docs first — see docs/weathernext-integration-plan.md §10.',
        'Open-Meteo fallback in effect.',
      ],
    };

    // Unreachable today, but kept so the timeout/abort plumbing is ready
    // when the body lands. (Type-checker won't complain — fall through.)
    // eslint-disable-next-line no-unreachable
    // const res = await fetch(url, { signal: t.signal, ... });
  } catch (err: any) {
    if (t.didTimeout()) {
      return {
        ok: false,
        failureMode: 'timeout',
        notes: [`Vertex AI request exceeded ${timeoutMs}ms timeout.`],
      };
    }
    return {
      ok: false,
      failureMode: 'network_error',
      notes: [`Vertex AI network error: ${err?.message ?? 'unknown'}`],
    };
  } finally {
    t.cancel();
  }
}
