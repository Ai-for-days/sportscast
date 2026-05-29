// ── Step 173 Part A: WeatherNext normalization scaffold ──────────────────
//
// Pure, side-effect-free scaffold that turns a (still-hypothetical)
// WeatherNext Vertex AI response into the normalized shape WagerOnWeather
// already speaks. **The real Vertex AI contract is not yet confirmed**
// (Step 171 probe still returns `endpoint_unconfirmed` by default). This
// module therefore exists to make the eventual wiring trivial WITHOUT
// pretending we already know the schema:
//
//   - `detectWeatherNextResponseShape(payload)` classifies the
//     candidate shape by the field names actually present.
//   - `summarizeWeatherNextNormalizationGaps(payload)` reports which
//     required fields would have to be sourced before the response can
//     be normalized.
//   - `normalizeWeatherNextForecast(payload)` returns a
//     `WeatherNextNormalizationResult` with a `normalizationStatus` of
//     `contract_unconfirmed` / `missing_required_fields` / `ok`. **It
//     never fabricates forecast values.** Unknown shapes return
//     `contract_unconfirmed` with empty mapped fields so the caller can
//     surface the gap to an operator instead of silently degrading.
//   - `isWeatherNextContractConfirmed(payload)` is the strict yes/no
//     boolean — true ONLY when every required mapped field is present
//     AND the detected shape is one we already know how to read.
//
// **No public exposure.** The admin probe is the only consumer today.

if (typeof window !== 'undefined') {
  // Module is safe in either env, but the consumer paths are admin-only.
}

// ── Public types ──────────────────────────────────────────────────────────

/** Detected shape labels — extend as new WeatherNext responses are observed. */
export type WeatherNextResponseShape =
  | 'unknown'
  | 'vertex_predictions_array'
  | 'vertex_instance_object'
  | 'forecast_envelope_object';

export type WeatherNextNormalizationStatus =
  | 'contract_unconfirmed'
  | 'missing_required_fields'
  | 'ok';

/** Normalized forecast record — one row per `(location, date)` tuple. */
export interface NormalizedWeatherNextForecast {
  providerId: 'weathernext';
  generatedAt?: string;
  sourceRunId?: string;
  latitude?: number;
  longitude?: number;
  forecastDate?: string;
  highTempF?: number;
  lowTempF?: number;
  precipitationProbability?: number;
  precipitationAmount?: number;
  windSpeed?: number;
  windGust?: number;
  ensembleMean?: number;
  ensembleSpread?: number;
  confidenceMetadata?: Record<string, unknown>;
  normalizationStatus: WeatherNextNormalizationStatus;
}

export interface WeatherNextNormalizationResult {
  /** Detected response shape — drives the field-mapping path used. */
  detectedShape: WeatherNextResponseShape;
  /** Overall status of the normalization attempt. */
  status: WeatherNextNormalizationStatus;
  /** Empty array when status !== 'ok'. */
  forecasts: NormalizedWeatherNextForecast[];
  /** Names of WeatherNext source fields that the scaffold mapped. */
  mappedFields: string[];
  /** Names of required normalized fields that the source did not provide. */
  missingRequiredFields: string[];
  /** Admin-safe explanation suitable for the probe UI. */
  notes: string[];
}

// ── Required field policy ─────────────────────────────────────────────────

/** Required normalized fields before `status='ok'` is emitted. */
const REQUIRED_NORMALIZED_FIELDS: readonly (keyof NormalizedWeatherNextForecast)[] = [
  'forecastDate',
  'highTempF',
  'lowTempF',
] as const;

// ── Shape detection ───────────────────────────────────────────────────────

/**
 * Classifies the candidate response shape by the field names present.
 * Pure — examines top-level keys + one level of nesting only. **Never
 * throws.** Returns `'unknown'` whenever the shape doesn't match any of
 * the labeled candidates.
 *
 * Shape policies:
 *   - `vertex_predictions_array` — `{ predictions: [ {...}, ... ] }`,
 *     the canonical Vertex AI predict response. Each prediction is a
 *     candidate forecast row.
 *   - `vertex_instance_object` — `{ instances?: [...], outputs?: ... }`
 *     style. Seen on some Vertex AI custom containers.
 *   - `forecast_envelope_object` — `{ forecast: {...}, source?: ... }`
 *     or `{ forecasts: [...] }` envelope shapes some WeatherNext
 *     model-card examples emit.
 */
export function detectWeatherNextResponseShape(
  payload: unknown,
): WeatherNextResponseShape {
  if (!isPlainObject(payload)) return 'unknown';
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.predictions)) return 'vertex_predictions_array';
  if (Array.isArray(p.outputs) || Array.isArray(p.instances)) return 'vertex_instance_object';
  if (isPlainObject(p.forecast) || Array.isArray(p.forecasts)) return 'forecast_envelope_object';
  return 'unknown';
}

// ── Gap analysis ──────────────────────────────────────────────────────────

/**
 * Returns the list of `REQUIRED_NORMALIZED_FIELDS` that the candidate
 * payload would NOT be able to populate, given the current scaffold
 * mapping. Useful for the probe UI's "missing required fields" list.
 *
 * Pure. Never throws. Empty array means the scaffold could fully
 * normalize the candidate (subject to actual values appearing in the
 * downstream `normalizeWeatherNextForecast` pass).
 */
export function summarizeWeatherNextNormalizationGaps(
  payload: unknown,
): string[] {
  const shape = detectWeatherNextResponseShape(payload);
  if (shape === 'unknown') {
    // Without a known shape we can't say which fields would be missing
    // — every required field is implicitly missing.
    return REQUIRED_NORMALIZED_FIELDS.slice();
  }
  const sample = extractFirstCandidate(payload, shape);
  if (!sample) return REQUIRED_NORMALIZED_FIELDS.slice();
  const mapped = mapCandidateToNormalized(sample);
  return REQUIRED_NORMALIZED_FIELDS.filter((f) => mapped[f] === undefined);
}

// ── Normalizer ────────────────────────────────────────────────────────────

/**
 * Pure normalizer. **Never throws. Never fabricates values.** Returns a
 * complete `WeatherNextNormalizationResult` even when the payload is
 * unknown or partially populated, so the admin UI always has something
 * to render.
 *
 *   - Unknown shape → `status='contract_unconfirmed'`, empty forecasts.
 *   - Known shape with any required field missing →
 *     `status='missing_required_fields'`, empty forecasts.
 *   - Known shape with every required field present → `status='ok'`
 *     with one normalized record per candidate row.
 */
export function normalizeWeatherNextForecast(
  payload: unknown,
): WeatherNextNormalizationResult {
  const detectedShape = detectWeatherNextResponseShape(payload);
  if (detectedShape === 'unknown') {
    return {
      detectedShape,
      status: 'contract_unconfirmed',
      forecasts: [],
      mappedFields: [],
      missingRequiredFields: REQUIRED_NORMALIZED_FIELDS.slice(),
      notes: [
        'Response shape did not match any known WeatherNext envelope (vertex_predictions_array / vertex_instance_object / forecast_envelope_object).',
        'Confirm the deployed model card and extend `weathernext-normalizer.ts` before activating.',
      ],
    };
  }

  const candidates = extractAllCandidates(payload, detectedShape);
  if (candidates.length === 0) {
    return {
      detectedShape,
      status: 'missing_required_fields',
      forecasts: [],
      mappedFields: [],
      missingRequiredFields: REQUIRED_NORMALIZED_FIELDS.slice(),
      notes: [`Shape "${detectedShape}" was detected but no forecast candidate rows were extractable.`],
    };
  }

  const allMappedFields = new Set<string>();
  const allMissingFields = new Set<string>();
  const forecasts: NormalizedWeatherNextForecast[] = [];
  let anyMissing = false;

  for (const candidate of candidates) {
    const mapped = mapCandidateToNormalized(candidate);
    for (const key of Object.keys(mapped)) {
      if ((mapped as any)[key] !== undefined) allMappedFields.add(key);
    }
    const missing = REQUIRED_NORMALIZED_FIELDS.filter((f) => mapped[f] === undefined);
    for (const m of missing) allMissingFields.add(m);
    if (missing.length > 0) {
      anyMissing = true;
      continue; // Do not emit a partial record — never fabricate.
    }
    forecasts.push({
      providerId: 'weathernext',
      normalizationStatus: 'ok',
      ...mapped,
    });
  }

  if (forecasts.length === 0 || anyMissing) {
    return {
      detectedShape,
      status: 'missing_required_fields',
      forecasts: [], // Refuse partial output even when some rows were complete.
      mappedFields: Array.from(allMappedFields).sort(),
      missingRequiredFields: Array.from(allMissingFields),
      notes: [
        'At least one candidate row is missing required normalized fields (forecastDate / highTempF / lowTempF).',
        'No forecasts were emitted to preserve the no-fabrication rule.',
      ],
    };
  }

  return {
    detectedShape,
    status: 'ok',
    forecasts,
    mappedFields: Array.from(allMappedFields).sort(),
    missingRequiredFields: [],
    notes: [`Normalized ${forecasts.length} forecast row(s) from shape "${detectedShape}".`],
  };
}

/**
 * Strict yes/no — true only when normalization succeeded with every
 * required field populated. Convenience for callers that just want a
 * gating boolean.
 */
export function isWeatherNextContractConfirmed(payload: unknown): boolean {
  return normalizeWeatherNextForecast(payload).status === 'ok';
}

// ── Internal helpers ─────────────────────────────────────────────────────

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function extractFirstCandidate(
  payload: unknown,
  shape: WeatherNextResponseShape,
): Record<string, unknown> | null {
  return extractAllCandidates(payload, shape)[0] ?? null;
}

function extractAllCandidates(
  payload: unknown,
  shape: WeatherNextResponseShape,
): Record<string, unknown>[] {
  if (!isPlainObject(payload)) return [];
  const p = payload as Record<string, unknown>;
  if (shape === 'vertex_predictions_array' && Array.isArray(p.predictions)) {
    return p.predictions.filter(isPlainObject) as Record<string, unknown>[];
  }
  if (shape === 'vertex_instance_object') {
    const rows: Record<string, unknown>[] = [];
    if (Array.isArray(p.outputs)) {
      for (const o of p.outputs) if (isPlainObject(o)) rows.push(o);
    }
    if (Array.isArray(p.instances)) {
      for (const i of p.instances) if (isPlainObject(i)) rows.push(i);
    }
    return rows;
  }
  if (shape === 'forecast_envelope_object') {
    if (Array.isArray(p.forecasts)) {
      return p.forecasts.filter(isPlainObject) as Record<string, unknown>[];
    }
    if (isPlainObject(p.forecast)) {
      // Single-row envelope — return as a one-element array.
      return [p.forecast as Record<string, unknown>];
    }
  }
  return [];
}

/**
 * Map a single candidate row to the normalized field set. Reads from
 * a small allow-list of common WeatherNext / Vertex AI field names.
 * **Never invents data** — missing source fields stay `undefined`.
 */
function mapCandidateToNormalized(
  row: Record<string, unknown>,
): Partial<Omit<NormalizedWeatherNextForecast, 'providerId' | 'normalizationStatus'>> {
  return {
    generatedAt: pickString(row, ['generatedAt', 'generated_at', 'runTime', 'run_time', 'timestamp']),
    sourceRunId: pickString(row, ['sourceRunId', 'source_run_id', 'runId', 'run_id', 'model_version']),
    latitude: pickNumber(row, ['latitude', 'lat']),
    longitude: pickNumber(row, ['longitude', 'lon', 'lng']),
    forecastDate: pickString(row, ['forecastDate', 'forecast_date', 'date', 'targetDate', 'target_date']),
    highTempF: pickNumber(row, ['highTempF', 'high_temp_f', 'tmaxF', 'tmax_f', 'highF', 'high']),
    lowTempF: pickNumber(row, ['lowTempF', 'low_temp_f', 'tminF', 'tmin_f', 'lowF', 'low']),
    precipitationProbability: pickNumber(row, [
      'precipitationProbability',
      'precipitation_probability',
      'precip_probability',
      'pop',
    ]),
    precipitationAmount: pickNumber(row, [
      'precipitationAmount',
      'precipitation_amount',
      'precip_amount',
      'qpf',
    ]),
    windSpeed: pickNumber(row, ['windSpeed', 'wind_speed', 'windSpeedMph', 'wind_speed_mph']),
    windGust: pickNumber(row, ['windGust', 'wind_gust', 'gustMph', 'gust_mph']),
    ensembleMean: pickNumber(row, ['ensembleMean', 'ensemble_mean']),
    ensembleSpread: pickNumber(row, ['ensembleSpread', 'ensemble_spread', 'spread']),
    confidenceMetadata: pickObject(row, ['confidence', 'confidenceMetadata', 'confidence_metadata']),
  };
}

function pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function pickObject(row: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const k of keys) {
    const v = row[k];
    if (isPlainObject(v)) return v as Record<string, unknown>;
  }
  return undefined;
}
