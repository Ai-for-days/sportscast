// ── Step 136: Forecast provider comparison library ──────────────────────────
//
// Pure heuristic comparator over normalized ForecastResponse payloads from
// multiple providers. Used by the admin-only A-B harness in
// src/lib/forecast-provider-comparison-runner.ts. No betting, pricing,
// settlement, customer, or PII data flows through here.
//
// Important framing: this comparator does NOT pick a winner. It surfaces
// completeness, freshness, missing fields, and pairwise deltas so an
// operator can judge. Until a future step compares against ground-truth
// observations, "agreement" is just numerical proximity, not accuracy.

import type { ForecastResponse, ForecastPoint, DailyForecast } from './types';
import type { ForecastProvider } from './forecast-source';
import {
  FORECAST_PROVIDER_CAPABILITIES,
  type FieldQuality,
} from './forecast-provider-metadata';

// ── Per-provider run result ─────────────────────────────────────────────────

export interface ProviderRunResult {
  provider: ForecastProvider;
  /** Customer-friendly label, sourced from forecast.source.label or the provider metadata. */
  label: string;
  ok: boolean;
  /** Present when ok === true. */
  forecast?: ForecastResponse;
  /** Structured failure mode when ok === false. */
  failureMode?: string;
  notes: string[];
  /** Wall-clock fetch duration in ms (server-side measurement). */
  durationMs: number;
}

// ── Comparison output ───────────────────────────────────────────────────────

export type ComparisonField =
  | 'temperature'
  | 'precipitationProbability'
  | 'windSpeed'
  | 'windGust'
  | 'humidity'
  | 'cloudCover';

export interface FieldDelta {
  /** Internal field id. */
  field: ComparisonField;
  /** Customer-friendly label. */
  label: string;
  /** Per-provider value at the comparison point (rounded). May be null. */
  values: Record<string, number | null>;
  /** Max absolute delta across the provider pairs. Null when only one provider has a value. */
  maxDelta: number | null;
  /** Unit suffix for display (e.g., "°F", "mph", "%"). */
  unit: string;
}

export interface ProviderComparisonResult {
  /** Provider ids that participated (in order). */
  providers: string[];
  /** Per-provider 0–100 completeness score. */
  completeness: Record<string, number>;
  /** Per-provider freshness in minutes from now. Null when no generatedAt. */
  freshnessMinutes: Record<string, number | null>;
  /** Per-provider list of fields that are NOT 'real' per provider metadata. */
  missingOrDerivedFields: Record<string, string[]>;
  /** Key forecast metric deltas evaluated at "current" / "next 12h max". */
  fieldDeltas: FieldDelta[];
  /** Pairwise agreement score 0–100 — higher = closer numerical agreement. */
  agreement: Record<string, number>;
  /** Notes/warnings (per-provider failures or other observations). */
  warnings: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const COMPARISON_FIELDS: Array<{ field: ComparisonField; label: string; unit: string }> = [
  { field: 'temperature', label: 'Temperature (current)', unit: '°F' },
  { field: 'precipitationProbability', label: 'Precip probability (next 12h max)', unit: '%' },
  { field: 'windSpeed', label: 'Wind speed (current)', unit: 'mph' },
  { field: 'windGust', label: 'Wind gust (next 12h max)', unit: 'mph' },
  { field: 'humidity', label: 'Humidity (current)', unit: '%' },
  { field: 'cloudCover', label: 'Cloud cover (current)', unit: '%' },
];

function nullable(n: number | undefined | null): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function next12hMax(hourly: ForecastPoint[] | undefined, key: keyof ForecastPoint): number | null {
  if (!hourly || hourly.length === 0) return null;
  const slice = hourly.slice(0, 12);
  let m = -Infinity;
  for (const p of slice) {
    const v = p[key];
    if (typeof v === 'number' && Number.isFinite(v)) m = Math.max(m, v);
  }
  return m === -Infinity ? null : m;
}

function extractFieldValue(forecast: ForecastResponse, field: ComparisonField): number | null {
  switch (field) {
    case 'temperature':
      return nullable(forecast.current?.tempF);
    case 'precipitationProbability':
      return next12hMax(forecast.hourly, 'precipProbability');
    case 'windSpeed':
      return nullable(forecast.current?.windSpeedMph);
    case 'windGust':
      return next12hMax(forecast.hourly, 'windGustMph');
    case 'humidity':
      return nullable(forecast.current?.humidity);
    case 'cloudCover':
      return nullable(forecast.current?.cloudCover);
  }
}

function computeCompleteness(provider: ForecastProvider): number {
  const caps = FORECAST_PROVIDER_CAPABILITIES[provider];
  if (!caps) return 0;
  const fields = Object.values(caps.fields) as FieldQuality[];
  if (fields.length === 0) return 0;
  const realCount = fields.filter((q) => q === 'real').length;
  return Math.round((realCount / fields.length) * 100);
}

function listNonRealFields(provider: ForecastProvider): string[] {
  const caps = FORECAST_PROVIDER_CAPABILITIES[provider];
  if (!caps) return [];
  const out: string[] = [];
  for (const [name, quality] of Object.entries(caps.fields)) {
    if (quality !== 'real') out.push(`${name}=${quality}`);
  }
  return out;
}

function freshnessMinutes(generatedAt: string | undefined): number | null {
  if (!generatedAt) return null;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return 0;
  return Math.round(diff / 60000);
}

function maxAbsDelta(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return null;
  let max = 0;
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      max = Math.max(max, Math.abs(present[i] - present[j]));
    }
  }
  return Math.round(max * 10) / 10;
}

/**
 * Pairwise agreement score 0–100. Heuristic: average of per-field similarity
 * across the 6 comparison fields, where similarity = 100 - clamped(percent
 * delta against a per-field tolerance). Returns 100 when only one provider
 * has data (nothing to disagree with). NEVER claims accuracy — just
 * numerical proximity.
 */
function pairwiseAgreement(
  provA: ProviderRunResult,
  provB: ProviderRunResult,
): number {
  if (!provA.forecast || !provB.forecast) return 0;
  const tolerances: Record<ComparisonField, number> = {
    temperature: 5,
    precipitationProbability: 20,
    windSpeed: 4,
    windGust: 6,
    humidity: 10,
    cloudCover: 20,
  };
  let totalScore = 0;
  let scored = 0;
  for (const { field } of COMPARISON_FIELDS) {
    const a = extractFieldValue(provA.forecast, field);
    const b = extractFieldValue(provB.forecast, field);
    if (a === null || b === null) continue;
    const tol = tolerances[field];
    const diff = Math.abs(a - b);
    const ratio = Math.min(1, diff / tol);
    totalScore += (1 - ratio) * 100;
    scored += 1;
  }
  if (scored === 0) return 0;
  return Math.round(totalScore / scored);
}

// ── Public entry point ──────────────────────────────────────────────────────

export function compareProviderForecasts(results: ProviderRunResult[]): ProviderComparisonResult {
  const okResults = results.filter((r) => r.ok && r.forecast);
  const providers = results.map((r) => r.provider);

  const completeness: Record<string, number> = {};
  const freshness: Record<string, number | null> = {};
  const missing: Record<string, string[]> = {};
  for (const r of results) {
    completeness[r.provider] = r.ok ? computeCompleteness(r.provider) : 0;
    freshness[r.provider] = r.ok ? freshnessMinutes(r.forecast?.generatedAt) : null;
    missing[r.provider] = r.ok ? listNonRealFields(r.provider) : ['(provider failed — see notes)'];
  }

  const fieldDeltas: FieldDelta[] = COMPARISON_FIELDS.map(({ field, label, unit }) => {
    const values: Record<string, number | null> = {};
    for (const r of results) {
      values[r.provider] = r.forecast ? extractFieldValue(r.forecast, field) : null;
    }
    const present = Object.values(values).filter((v): v is number => v !== null);
    const maxDelta = present.length >= 2 ? maxAbsDelta(present) : null;
    return { field, label, values, maxDelta, unit };
  });

  const agreement: Record<string, number> = {};
  for (let i = 0; i < okResults.length; i++) {
    for (let j = i + 1; j < okResults.length; j++) {
      const a = okResults[i];
      const b = okResults[j];
      const key = `${a.provider} vs ${b.provider}`;
      agreement[key] = pairwiseAgreement(a, b);
    }
  }

  const warnings: string[] = [];
  for (const r of results) {
    if (!r.ok) {
      warnings.push(`${r.label}: ${r.failureMode ?? 'failed'} — ${r.notes.join(' ')}`);
    }
  }

  return {
    providers,
    completeness,
    freshnessMinutes: freshness,
    missingOrDerivedFields: missing,
    fieldDeltas,
    agreement,
    warnings,
  };
}
