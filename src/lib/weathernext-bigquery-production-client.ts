// ── Step 142: WeatherNext BigQuery production client (stub, server-only) ───
//
// Skeleton for the planned BigQuery production WeatherNext fallback path.
// Mirrors the Step 135 Vertex AI client posture: typed result, fail-
// closed, never throws into page rendering. Currently returns
// `failureMode: 'contract_unconfirmed'` for every call because the
// production dataset / table / schema have not been verified against
// authoritative Google docs.
//
// Critical safety:
//   - Server-only — browser-import throws.
//   - Refuses to issue any BigQuery query while the contract is
//     unconfirmed. There is NO query body in this build — guessing the
//     production schema would risk silently returning wrong-shape data.
//   - Reuses the existing GCP credential pattern (`getBigQueryClient`
//     from `bigquery.ts`); does not introduce a new auth surface.
//   - Never returns secrets, query strings, or env values to the caller.
//   - Does not import or call `nws-grading.ts` / `nws-observations.ts`.

import type { ForecastResponse } from './types';
import {
  getWeatherNextBigQueryReadiness,
  WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED,
} from './weathernext-bigquery-readiness';

if (typeof window !== 'undefined') {
  throw new Error(
    'weathernext-bigquery-production-client is server-only and must not be imported in client code',
  );
}

// Step 170 — local env read to avoid a cyclic import with `forecast-provider.ts`.
function readWeatherNextFeatureFlag(): boolean {
  const fromVite =
    typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env['WEATHER_PROVIDER_WEATHERNEXT_ENABLED'];
  let raw: string | undefined;
  if (typeof fromVite === 'string' && fromVite.length > 0) raw = fromVite;
  else if (typeof process !== 'undefined' && process.env) {
    const v = process.env['WEATHER_PROVIDER_WEATHERNEXT_ENABLED'];
    if (typeof v === 'string' && v.length > 0) raw = v;
  }
  if (!raw) return false;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export type WeatherNextBigQueryFailureMode =
  /** Required env (project / dataset / table / credentials) is missing. */
  | 'unconfigured'
  /** Production dataset/table/schema not yet confirmed; query intentionally
   *  not implemented in this build. */
  | 'contract_unconfirmed'
  /** Step 170 — `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` is not true. */
  | 'feature_flag_disabled'
  /** Query body is not implemented — placeholder for the future. */
  | 'query_unimplemented'
  /** BigQuery client refused / auth rejected. */
  | 'auth_error'
  /** Network-level error. */
  | 'network_error'
  /** Response shape didn't match expectations. */
  | 'schema_mismatch'
  /** Unexpected failure not classified above. */
  | 'unknown';

export interface WeatherNextBigQuerySuccess {
  ok: true;
  forecast: ForecastResponse;
  notes: string[];
}

export interface WeatherNextBigQueryFailure {
  ok: false;
  failureMode: WeatherNextBigQueryFailureMode;
  notes: string[];
}

export type WeatherNextBigQueryResult =
  | WeatherNextBigQuerySuccess
  | WeatherNextBigQueryFailure;

/**
 * Attempt to fetch a normalized forecast from the production WeatherNext
 * BigQuery tables. **Never throws** — every error path is classified.
 *
 * Status: **stub**. Returns `failureMode: 'contract_unconfirmed'` for
 * every call until the production dataset/table/schema are verified and
 * `WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED` is flipped to `true`. The
 * caller (`weather-queries.ts`) must serve Open-Meteo on `!ok`.
 */
export async function tryWeatherNextBigQueryForecast(
  lat: number,
  lon: number,
  days: number,
): Promise<WeatherNextBigQueryResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(days) || days <= 0) {
    return {
      ok: false,
      failureMode: 'unknown',
      notes: [`Invalid input: lat=${lat}, lon=${lon}, days=${days}`],
    };
  }

  // Step 170 — defensive feature-flag kill switch. Same posture as the
  // Vertex AI client: no BigQuery production query attempt runs unless
  // `WEATHER_PROVIDER_WEATHERNEXT_ENABLED` is explicitly true. Read
  // inline to avoid a cyclic import.
  const wnFlag = readWeatherNextFeatureFlag();
  if (!wnFlag) {
    return {
      ok: false,
      failureMode: 'feature_flag_disabled',
      notes: [
        'WEATHER_PROVIDER_WEATHERNEXT_ENABLED is not "true" — WeatherNext attempts are disabled by Step 170 safety posture.',
      ],
    };
  }

  const readiness = getWeatherNextBigQueryReadiness();

  if (!WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED) {
    return {
      ok: false,
      failureMode: 'contract_unconfirmed',
      notes: [
        'WeatherNext BigQuery production query path is disabled in this build — the dataset/table/schema have not been verified against authoritative Google docs.',
        'See docs/weathernext-contract-readiness.md.',
        readiness.ready
          ? 'Required env is configured; flipping WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED to true requires direct schema verification first.'
          : `Required env is also incomplete: missing ${readiness.missing.join(', ')}.`,
      ],
    };
  }

  if (!readiness.ready) {
    return {
      ok: false,
      failureMode: 'unconfigured',
      notes: [
        `WeatherNext BigQuery production env is incomplete. Missing: ${readiness.missing.join(', ')}.`,
        'See docs/weathernext-contract-readiness.md.',
      ],
    };
  }

  // Unreachable while WEATHERNEXT_BIGQUERY_CONTRACT_CONFIRMED is false.
  // Left as a placeholder so the future implementer knows where the
  // confirmed-schema query body lands.
  return {
    ok: false,
    failureMode: 'query_unimplemented',
    notes: [
      'Contract flag is set but the BigQuery production query body has not been implemented yet.',
      'See docs/weathernext-contract-readiness.md §9 rollout checklist.',
    ],
  };
}
