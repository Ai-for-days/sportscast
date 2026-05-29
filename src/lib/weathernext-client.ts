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

// ── Step 171: Vertex AI contract probe (admin-only, diagnostic-only) ─────
//
// Helpers used by `/api/admin/system/weathernext-probe` to verify the
// Vertex AI request/response contract without touching the public
// forecast surface. **All outputs are sanitized — no raw credentials,
// no tokens, no full payloads, no sensitive headers are returned.**
//
// Activation gate:
//   - `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` must be true (Step 170 kill switch).
//   - `WEATHERNEXT_VERTEX_PROBE_ENABLED` must be true.
//   - Required env: GCP_PROJECT_ID + GCP_CREDENTIALS_BASE64 + WEATHERNEXT_VERTEX_REGION + WEATHERNEXT_VERTEX_ENDPOINT_ID.
//
// If any gate fails the probe returns a structured status WITHOUT
// touching the network. When all gates pass, it issues **exactly one**
// authenticated POST to the configured Vertex AI `:predict` endpoint
// with a conservative probe body, classifies the result, and returns
// a sanitized shape summary.

export type WeatherNextProbeStatus =
  | 'disabled'
  | 'probe_disabled'
  | 'missing_config'
  | 'credentials_invalid'
  | 'endpoint_unreachable'
  | 'contract_rejected'
  | 'contract_confirmed'
  | 'unexpected_response';

export interface WeatherNextProbeConfigStatus {
  weatherNextEnabled: boolean;
  probeEnabled: boolean;
  hasProjectId: boolean;
  hasCredentials: boolean;
  hasRegion: boolean;
  hasEndpointId: boolean;
}

export interface WeatherNextResponseShapeSummary {
  topLevelKeys: string[];
  sampleFieldTypes: Record<string, string>;
  forecastLikeFields?: string[];
}

export interface WeatherNextProbeResult {
  ok: boolean;
  status: WeatherNextProbeStatus;
  config: WeatherNextProbeConfigStatus;
  endpoint?: {
    region?: string;
    endpointIdPresent: boolean;
  };
  requestShapeAttempted?: string;
  /** HTTP status code when applicable. Always omitted when no network call was made. */
  httpStatus?: number;
  responseShapeSummary?: WeatherNextResponseShapeSummary;
  notes: string[];
  nextAction?: string;
}

// ── Step 172: structured readiness checklist (UI/docs/readiness only) ───

export type ReadinessItemState = 'present' | 'missing' | 'unsafe';

export interface ReadinessItem {
  /** Stable id used for React keys + audit. */
  id:
    | 'weatherNextEnabled'
    | 'probeEnabled'
    | 'projectId'
    | 'credentialsBase64'
    | 'region'
    | 'endpointId'
    | 'publicForecastProvider'
    | 'fallbackForecastProvider';
  /** Display label. */
  label: string;
  /** Env var the item inspects. */
  envVar: string;
  state: ReadinessItemState;
  /** Short user-facing explanation. */
  explanation: string;
  /** Concrete next action. */
  nextAction: string;
}

export type SafeToProbeVerdict =
  | 'not_ready_missing_config'
  | 'not_ready_probe_disabled'
  | 'ready_to_run_one_probe'
  | 'unsafe_config_public_provider_not_openmeteo';

export interface WeatherNextReadiness {
  items: ReadinessItem[];
  safeToProbe: SafeToProbeVerdict;
  publicForecastFlow: 'unchanged_open_meteo';
  /** Stable timestamp the checklist was computed at. */
  computedAt: string;
}

function classifyProviderEnv(
  value: string | undefined,
): { state: ReadinessItemState; resolved: 'openmeteo' | 'weathernext' | 'unset' | 'unknown' } {
  if (!value) return { state: 'present', resolved: 'unset' }; // unset defaults to openmeteo safely
  const v = value.trim().toLowerCase();
  if (v === 'openmeteo' || v === 'open-meteo' || v === 'open_meteo') {
    return { state: 'present', resolved: 'openmeteo' };
  }
  if (v === 'weathernext' || v === 'weather-next' || v === 'weather_next') {
    return { state: 'unsafe', resolved: 'weathernext' };
  }
  return { state: 'unsafe', resolved: 'unknown' };
}

/**
 * Pure read-only readiness inspector. **No I/O beyond env reads.** Used
 * by the Step 172 admin runbook panel + the admin API GET so the
 * operator can see exactly what is missing and what to fix.
 *
 * Public provider safety: when `PUBLIC_FORECAST_PROVIDER` is anything
 * other than `openmeteo` (or unset, which defaults to openmeteo), the
 * verdict flips to `unsafe_config_public_provider_not_openmeteo` even
 * if everything else is configured. The probe button is gated on this
 * verdict client-side; the server still allows the POST because the
 * probe itself is admin-only and diagnostic-only.
 */
export function getWeatherNextReadiness(): WeatherNextReadiness {
  const cfg = validateWeatherNextVertexConfig();
  const publicProvider = classifyProviderEnv(readEnv('PUBLIC_FORECAST_PROVIDER'));
  const fallbackProvider = classifyProviderEnv(readEnv('FALLBACK_FORECAST_PROVIDER'));

  const items: ReadinessItem[] = [
    {
      id: 'weatherNextEnabled',
      label: 'WeatherNext kill switch (Step 170)',
      envVar: 'WEATHER_PROVIDER_WEATHERNEXT_ENABLED',
      state: cfg.weatherNextEnabled ? 'present' : 'missing',
      explanation: cfg.weatherNextEnabled
        ? 'Step 170 kill switch is true — WeatherNext attempts are allowed by the foundation layer.'
        : 'Step 170 kill switch is not "true" — the probe and any Vertex AI attempt will return disabled.',
      nextAction: cfg.weatherNextEnabled
        ? 'No action needed.'
        : 'Set WEATHER_PROVIDER_WEATHERNEXT_ENABLED=true on the Vercel deployment.',
    },
    {
      id: 'probeEnabled',
      label: 'Probe-specific kill switch (Step 171)',
      envVar: 'WEATHERNEXT_VERTEX_PROBE_ENABLED',
      state: cfg.probeEnabled ? 'present' : 'missing',
      explanation: cfg.probeEnabled
        ? 'Step 171 probe is allowed to fire a controlled call.'
        : 'Step 171 probe kill switch is not "true" — POST will refuse to call Vertex AI.',
      nextAction: cfg.probeEnabled
        ? 'No action needed.'
        : 'Set WEATHERNEXT_VERTEX_PROBE_ENABLED=true on the Vercel deployment.',
    },
    {
      id: 'projectId',
      label: 'GCP project id',
      envVar: 'GCP_PROJECT_ID',
      state: cfg.hasProjectId ? 'present' : 'missing',
      explanation: cfg.hasProjectId
        ? 'Project id is configured.'
        : 'Project id is missing — required to build the Vertex AI predict URL.',
      nextAction: cfg.hasProjectId ? 'No action needed.' : 'Set GCP_PROJECT_ID on the Vercel deployment.',
    },
    {
      id: 'credentialsBase64',
      label: 'GCP service-account credentials',
      envVar: 'GCP_CREDENTIALS_BASE64',
      state: cfg.hasCredentials ? 'present' : 'missing',
      explanation: cfg.hasCredentials
        ? 'Service-account credentials are configured (raw value never exposed).'
        : 'Service-account credentials are missing — required to acquire an OAuth token via google-auth-library.',
      nextAction: cfg.hasCredentials
        ? 'No action needed.'
        : 'base64-encode the service-account key JSON and set GCP_CREDENTIALS_BASE64 on the Vercel deployment.',
    },
    {
      id: 'region',
      label: 'Vertex AI region',
      envVar: 'WEATHERNEXT_VERTEX_REGION',
      state: cfg.hasRegion ? 'present' : 'missing',
      explanation: cfg.hasRegion
        ? 'Vertex AI region is configured.'
        : 'Vertex AI region is missing — required to build the predict URL.',
      nextAction: cfg.hasRegion
        ? 'No action needed.'
        : 'Set WEATHERNEXT_VERTEX_REGION (e.g. us-central1) on the Vercel deployment.',
    },
    {
      id: 'endpointId',
      label: 'Vertex AI endpoint id',
      envVar: 'WEATHERNEXT_VERTEX_ENDPOINT_ID',
      state: cfg.hasEndpointId ? 'present' : 'missing',
      explanation: cfg.hasEndpointId
        ? 'Endpoint id is configured (raw value never exposed).'
        : 'Endpoint id is missing — required to address the deployed Vertex AI endpoint.',
      nextAction: cfg.hasEndpointId
        ? 'No action needed.'
        : 'Set WEATHERNEXT_VERTEX_ENDPOINT_ID on the Vercel deployment.',
    },
    {
      id: 'publicForecastProvider',
      label: 'Public forecast provider (must remain openmeteo)',
      envVar: 'PUBLIC_FORECAST_PROVIDER',
      state: publicProvider.state,
      explanation:
        publicProvider.resolved === 'openmeteo'
          ? 'Public ZIP-code forecasts are served by Open-Meteo (Step 170 default).'
          : publicProvider.resolved === 'unset'
            ? 'Env unset — defaults to openmeteo. Safe.'
            : publicProvider.resolved === 'weathernext'
              ? 'UNSAFE: PUBLIC_FORECAST_PROVIDER is set to weathernext while WeatherNext is still endpoint_unconfirmed. The public ZIP-code experience would be degraded.'
              : `UNSAFE: PUBLIC_FORECAST_PROVIDER is set to an unrecognized value — public forecasts could fall back unexpectedly.`,
      nextAction:
        publicProvider.resolved === 'openmeteo' || publicProvider.resolved === 'unset'
          ? 'No action needed.'
          : 'Set PUBLIC_FORECAST_PROVIDER=openmeteo (or unset it) on the Vercel deployment before running the probe.',
    },
    {
      id: 'fallbackForecastProvider',
      label: 'Fallback forecast provider (must remain openmeteo)',
      envVar: 'FALLBACK_FORECAST_PROVIDER',
      state: fallbackProvider.state,
      explanation:
        fallbackProvider.resolved === 'openmeteo'
          ? 'Fallback is Open-Meteo — when the primary provider is unavailable, users still see a forecast.'
          : fallbackProvider.resolved === 'unset'
            ? 'Env unset — defaults to openmeteo. Safe.'
            : 'UNSAFE: FALLBACK_FORECAST_PROVIDER is not openmeteo — the safety net for the public surface is weakened.',
      nextAction:
        fallbackProvider.resolved === 'openmeteo' || fallbackProvider.resolved === 'unset'
          ? 'No action needed.'
          : 'Set FALLBACK_FORECAST_PROVIDER=openmeteo (or unset it) on the Vercel deployment.',
    },
  ];

  // Verdict order: unsafe public provider wins over everything (it
  // means the operator should NOT flip more switches before reverting).
  let safeToProbe: SafeToProbeVerdict;
  if (publicProvider.state === 'unsafe') {
    safeToProbe = 'unsafe_config_public_provider_not_openmeteo';
  } else if (!cfg.weatherNextEnabled || !cfg.probeEnabled) {
    safeToProbe = 'not_ready_probe_disabled';
  } else if (!cfg.hasProjectId || !cfg.hasCredentials || !cfg.hasRegion || !cfg.hasEndpointId) {
    safeToProbe = 'not_ready_missing_config';
  } else {
    safeToProbe = 'ready_to_run_one_probe';
  }

  return {
    items,
    safeToProbe,
    publicForecastFlow: 'unchanged_open_meteo',
    computedAt: new Date().toISOString(),
  };
}

const PROBE_REQUEST_LABEL = 'initial_vertex_weather_forecast_probe_v1';
const PROBE_DEFAULT_LAT = 40.7128;
const PROBE_DEFAULT_LON = -74.006;
const PROBE_TIMEOUT_MS = 8000;
/** Hard cap on response body bytes inspected for shape summary. */
const PROBE_RESPONSE_BYTES_CAP = 64 * 1024;

/**
 * Read-only config inspector. **No network call.** Used by the GET
 * variant of the probe endpoint.
 */
export function validateWeatherNextVertexConfig(): WeatherNextProbeConfigStatus {
  const weatherNextEnabled = isFlagTrue(readEnv('WEATHER_PROVIDER_WEATHERNEXT_ENABLED'));
  const probeEnabled = isFlagTrue(readEnv('WEATHERNEXT_VERTEX_PROBE_ENABLED'));
  const cfg = getWeatherNextConfigStatus();
  return {
    weatherNextEnabled,
    probeEnabled,
    hasProjectId: cfg.hasProjectId,
    hasCredentials: cfg.hasCredentials,
    hasRegion: cfg.hasRegion,
    hasEndpointId: cfg.hasEndpointId,
  };
}

/**
 * Pure request body builder. Labeled with a stable shape id so future
 * iterations can be tracked clearly via probe history / audit.
 */
export function buildWeatherNextProbeRequest(opts: { lat: number; lon: number }): {
  shapeLabel: string;
  body: any;
} {
  return {
    shapeLabel: PROBE_REQUEST_LABEL,
    body: {
      instances: [
        {
          latitude: opts.lat,
          longitude: opts.lon,
        },
      ],
    },
  };
}

/**
 * Pure response shape summarizer. Returns at most 8 top-level keys + at
 * most 24 sample field types. Never includes raw values — only type
 * names. Field names heuristically flagged as forecast-like (temp /
 * precip / wind / forecast / daily / hourly) are listed separately.
 */
export function summarizeWeatherNextResponseShape(payload: any): WeatherNextResponseShapeSummary {
  if (!payload || typeof payload !== 'object') {
    return { topLevelKeys: [], sampleFieldTypes: {}, forecastLikeFields: [] };
  }
  const keys = Object.keys(payload).slice(0, 8);
  const sampleFieldTypes: Record<string, string> = {};
  const forecastLikeFields: string[] = [];
  const forecastPattern = /forecast|temp|precip|wind|gust|humidity|daily|hourly|prediction/i;
  let collected = 0;
  for (const k of keys) {
    if (collected >= 24) break;
    sampleFieldTypes[k] = describeType(payload[k]);
    if (forecastPattern.test(k)) forecastLikeFields.push(k);
    collected += 1;
    // Walk one level into objects/arrays to catch nested forecast fields.
    const child = payload[k];
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const ck of Object.keys(child).slice(0, 8)) {
        if (collected >= 24) break;
        const path = `${k}.${ck}`;
        sampleFieldTypes[path] = describeType(child[ck]);
        if (forecastPattern.test(ck)) forecastLikeFields.push(path);
        collected += 1;
      }
    } else if (Array.isArray(child) && child.length > 0 && typeof child[0] === 'object') {
      for (const ck of Object.keys(child[0]).slice(0, 8)) {
        if (collected >= 24) break;
        const path = `${k}[0].${ck}`;
        sampleFieldTypes[path] = describeType((child[0] as any)[ck]);
        if (forecastPattern.test(ck)) forecastLikeFields.push(path);
        collected += 1;
      }
    }
  }
  return {
    topLevelKeys: keys,
    sampleFieldTypes,
    forecastLikeFields: forecastLikeFields.length > 0 ? forecastLikeFields : undefined,
  };
}

function describeType(v: any): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}

function isFlagTrue(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Issue exactly one controlled probe call to the configured Vertex AI
 * endpoint. **All preconditions fail-closed.** Returns a sanitized
 * `WeatherNextProbeResult` whose `status` discriminates between every
 * outcome the spec enumerates.
 *
 * Hard limits:
 *   - One fetch per call. Never retries.
 *   - 8s timeout via AbortController.
 *   - Response body capped at 64 KiB for shape inspection.
 *   - No credential / token / endpoint-id values are returned.
 */
export async function probeWeatherNextVertexContract(opts: {
  lat?: number;
  lon?: number;
} = {}): Promise<WeatherNextProbeResult> {
  const config = validateWeatherNextVertexConfig();
  const baseResult: Pick<WeatherNextProbeResult, 'config' | 'endpoint'> = {
    config,
    endpoint: {
      region: readEnv('WEATHERNEXT_VERTEX_REGION'),
      endpointIdPresent: !!readEnv('WEATHERNEXT_VERTEX_ENDPOINT_ID'),
    },
  };

  if (!config.weatherNextEnabled) {
    return {
      ok: false,
      status: 'disabled',
      ...baseResult,
      notes: [
        'WEATHER_PROVIDER_WEATHERNEXT_ENABLED is not "true" — Step 170 kill switch active.',
      ],
      nextAction: 'Set WEATHER_PROVIDER_WEATHERNEXT_ENABLED=true to allow Step 170 callers to attempt Vertex AI.',
    };
  }
  if (!config.probeEnabled) {
    return {
      ok: false,
      status: 'probe_disabled',
      ...baseResult,
      notes: [
        'WEATHERNEXT_VERTEX_PROBE_ENABLED is not "true" — diagnostic probe is disabled.',
      ],
      nextAction: 'Set WEATHERNEXT_VERTEX_PROBE_ENABLED=true to allow controlled probe calls from this endpoint.',
    };
  }
  const missing: string[] = [];
  if (!config.hasProjectId) missing.push('GCP_PROJECT_ID');
  if (!config.hasCredentials) missing.push('GCP_CREDENTIALS_BASE64');
  if (!config.hasRegion) missing.push('WEATHERNEXT_VERTEX_REGION');
  if (!config.hasEndpointId) missing.push('WEATHERNEXT_VERTEX_ENDPOINT_ID');
  if (missing.length > 0) {
    return {
      ok: false,
      status: 'missing_config',
      ...baseResult,
      notes: [`Missing required env: ${missing.join(', ')}.`],
      nextAction: 'Populate the missing env vars on the Vercel deployment, then re-run the probe.',
    };
  }

  const projectId = readEnv('GCP_PROJECT_ID')!;
  const region = readEnv('WEATHERNEXT_VERTEX_REGION')!;
  const endpointId = readEnv('WEATHERNEXT_VERTEX_ENDPOINT_ID')!;
  const apiVersion = readEnv('WEATHERNEXT_VERTEX_API_VERSION') ?? 'v1';
  const credentialsB64 = readEnv('GCP_CREDENTIALS_BASE64')!;
  const lat =
    typeof opts.lat === 'number'
      ? opts.lat
      : Number(readEnv('WEATHERNEXT_VERTEX_TEST_LAT')) || PROBE_DEFAULT_LAT;
  const lon =
    typeof opts.lon === 'number'
      ? opts.lon
      : Number(readEnv('WEATHERNEXT_VERTEX_TEST_LON')) || PROBE_DEFAULT_LON;

  // ── Acquire an OAuth access token via the bundled google-auth-library ──
  let accessToken: string | undefined;
  try {
    const credsJson = parseCredentialsBase64(credentialsB64);
    if (!credsJson || !credsJson.client_email || !credsJson.private_key) {
      return {
        ok: false,
        status: 'credentials_invalid',
        ...baseResult,
        notes: ['GCP_CREDENTIALS_BASE64 did not decode to a service-account JSON with client_email + private_key.'],
        nextAction:
          'Verify GCP_CREDENTIALS_BASE64 is a base64-encoded service-account JSON (the contents of the key.json file).',
      };
    }
    accessToken = await acquireVertexAccessToken(credsJson);
    if (!accessToken) {
      return {
        ok: false,
        status: 'credentials_invalid',
        ...baseResult,
        notes: ['google-auth-library did not return an access token — credentials may be incorrect or expired.'],
        nextAction: 'Re-issue the service-account key and confirm Vertex AI is enabled for the project.',
      };
    }
  } catch (err: any) {
    const message = String(err?.message ?? err);
    // google-auth-library load failures show up here too.
    if (/Cannot find module|MODULE_NOT_FOUND|google-auth-library/.test(message)) {
      return {
        ok: false,
        status: 'credentials_invalid',
        ...baseResult,
        notes: [
          'google-auth-library is not available in this build — the probe cannot authenticate.',
          'It normally comes in transitively via @google-cloud/bigquery. Reinstall dependencies if missing.',
        ],
        nextAction: 'Run `npm install` and confirm google-auth-library resolves before re-running the probe.',
      };
    }
    return {
      ok: false,
      status: 'credentials_invalid',
      ...baseResult,
      notes: [`Failed to acquire access token: ${sanitizeError(message)}`],
      nextAction: 'Verify the service-account key is current and Vertex AI is enabled for the project.',
    };
  }

  // ── Issue the probe call ───────────────────────────────────────────────
  const url = `https://${region}-aiplatform.googleapis.com/${apiVersion}/projects/${projectId}/locations/${region}/endpoints/${endpointId}:predict`;
  const probeReq = buildWeatherNextProbeRequest({ lat, lon });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(probeReq.body),
      signal: controller.signal,
    });
    const httpStatus = res.status;

    // Read at most PROBE_RESPONSE_BYTES_CAP for inspection.
    const raw = await readCappedBody(res);
    let parsed: any = null;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      // Parse failure handled below.
    }

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        ok: false,
        status: 'credentials_invalid',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        httpStatus,
        notes: [`Vertex AI returned ${httpStatus}: credentials rejected.`],
        nextAction:
          'Confirm the service account has roles/aiplatform.user and the endpoint is in the same project.',
      };
    }
    if (httpStatus === 404) {
      return {
        ok: false,
        status: 'endpoint_unreachable',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        httpStatus,
        notes: ['Vertex AI returned 404: project / region / endpoint id combination not found.'],
        nextAction: 'Re-check WEATHERNEXT_VERTEX_REGION and WEATHERNEXT_VERTEX_ENDPOINT_ID values.',
      };
    }
    if (httpStatus === 400 || httpStatus === 422) {
      return {
        ok: false,
        status: 'contract_rejected',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        httpStatus,
        responseShapeSummary: summarizeWeatherNextResponseShape(parsed),
        notes: [
          `Vertex AI rejected the probe body (${httpStatus}). The request shape "${probeReq.shapeLabel}" does not match the model's expected instance schema.`,
          ...extractStructuredErrorNotes(parsed),
        ],
        nextAction:
          'Inspect the returned error shape, adjust buildWeatherNextProbeRequest to match the deployed WeatherNext model schema, and re-run the probe.',
      };
    }
    if (httpStatus >= 500 || httpStatus === 0) {
      return {
        ok: false,
        status: 'endpoint_unreachable',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        httpStatus,
        notes: [`Vertex AI returned ${httpStatus}.`],
        nextAction: 'Re-run after a backoff; if the failure persists, check the Vertex AI console for endpoint health.',
      };
    }
    if (httpStatus !== 200) {
      return {
        ok: false,
        status: 'unexpected_response',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        httpStatus,
        responseShapeSummary: summarizeWeatherNextResponseShape(parsed),
        notes: [`Vertex AI returned an unexpected status ${httpStatus}.`],
        nextAction: 'Inspect the response shape summary and update the probe handler if a new status code needs classification.',
      };
    }
    // 200 — inspect the shape.
    const summary = summarizeWeatherNextResponseShape(parsed);
    const forecastLike = summary.forecastLikeFields ?? [];
    if (forecastLike.length === 0) {
      return {
        ok: false,
        status: 'unexpected_response',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        httpStatus,
        responseShapeSummary: summary,
        notes: [
          '200 OK but no forecast-like field names found at the top of the payload.',
          'The endpoint may be returning a model-specific format that needs an explicit mapping.',
        ],
        nextAction:
          'Compare topLevelKeys to the WeatherNext model card to determine which fields to normalize into the ForecastResponse shape.',
      };
    }
    return {
      ok: true,
      status: 'contract_confirmed',
      ...baseResult,
      requestShapeAttempted: probeReq.shapeLabel,
      httpStatus,
      responseShapeSummary: summary,
      notes: [
        '200 OK with forecast-like field names present. The probe request shape appears compatible with the deployed endpoint.',
      ],
      nextAction:
        'Use the response shape summary to implement the inference body in tryWeatherNextForecast and switch its return path off endpoint_unconfirmed.',
    };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (controller.signal.aborted) {
      return {
        ok: false,
        status: 'endpoint_unreachable',
        ...baseResult,
        requestShapeAttempted: probeReq.shapeLabel,
        notes: [`Probe timed out after ${PROBE_TIMEOUT_MS}ms.`],
        nextAction: 'Re-run from a deployment region closer to the Vertex AI endpoint or increase the probe timeout.',
      };
    }
    return {
      ok: false,
      status: 'endpoint_unreachable',
      ...baseResult,
      requestShapeAttempted: probeReq.shapeLabel,
      notes: [`Network error during probe: ${sanitizeError(message)}`],
      nextAction: 'Verify outbound HTTPS to *-aiplatform.googleapis.com from the deployment.',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Internal helpers (all server-only, all sanitized output) ───────────

interface ServiceAccountCredentials {
  type?: string;
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

function parseCredentialsBase64(b64: string): ServiceAccountCredentials | null {
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as ServiceAccountCredentials;
  } catch {
    return null;
  }
}

async function acquireVertexAccessToken(
  creds: ServiceAccountCredentials,
): Promise<string | undefined> {
  // Dynamic import keeps google-auth-library out of the client bundle.
  // It's available transitively via @google-cloud/bigquery in this build.
  const mod = await import('google-auth-library');
  const auth = new mod.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return typeof token === 'string'
    ? token
    : token && typeof token === 'object' && typeof token.token === 'string'
      ? token.token
      : undefined;
}

async function readCappedBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.slice(0, PROBE_RESPONSE_BYTES_CAP);
  }
  const decoder = new TextDecoder();
  let result = '';
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      result += decoder.decode(value, { stream: true });
      if (total >= PROBE_RESPONSE_BYTES_CAP) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
    }
  }
  result += decoder.decode();
  return result.slice(0, PROBE_RESPONSE_BYTES_CAP);
}

function extractStructuredErrorNotes(parsed: any): string[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const out: string[] = [];
  if (parsed.error && typeof parsed.error === 'object') {
    if (typeof parsed.error.status === 'string') out.push(`error.status=${parsed.error.status}`);
    if (typeof parsed.error.message === 'string') {
      const msg = parsed.error.message.length > 240
        ? parsed.error.message.slice(0, 240) + '…'
        : parsed.error.message;
      out.push(`error.message=${msg}`);
    }
  }
  return out;
}

function sanitizeError(message: string): string {
  // Strip anything that looks like a base64 segment, JWT, or long hex blob.
  let s = message.replace(/[A-Za-z0-9+/=]{64,}/g, '[redacted]');
  s = s.replace(/eyJ[A-Za-z0-9_\-.]+/g, '[redacted-jwt]');
  if (s.length > 240) s = s.slice(0, 240) + '…';
  return s;
}
