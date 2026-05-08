// ── Step 138: Seeded forecast quality batch runner (server-only) ────────────
//
// Two operations:
//
//   1. runSeededBatchComparison() — produces fresh provider-comparison
//      snapshots for every seeded city, with conservative concurrency so
//      no single forecast provider is hammered. Each snapshot is tagged
//      with its `seedCityId` so runBatchQualityReport() can find it later.
//
//   2. runBatchQualityReport() — for each seeded city, picks the most
//      recent eligible comparison snapshot (h0 horizon elapsed, with at
//      least the publication grace), runs the Step 137 quality gate
//      against NWS observations, and aggregates the per-(provider,
//      horizon, field, bucket) results into a compact report.
//
// Per-city and per-provider isolation: a single failure never sinks the
// whole batch. All exceptions are captured into structured warnings.
//
// Settlement boundary unchanged: this layer reads `nws-observations.ts`
// indirectly through the Step 137 quality-gate runner and writes only to
// the comparison + quality-gate + report stores. No grading, settlement,
// wallet, or customer-facing surface is touched.

import {
  FORECAST_QUALITY_SEED_CITIES,
  type ForecastQualitySeedCity,
} from './forecast-quality-seed-cities';
import {
  runProviderComparison,
  toCompactRun,
  type CompactComparisonRun,
} from './forecast-provider-comparison-runner';
import {
  recordComparisonRun,
  listComparisonRuns,
} from './forecast-provider-comparison-store';
import { runQualityGate } from './forecast-quality-gate-runner';
import { recordQualityGateResult } from './forecast-quality-gate-store';
import {
  horizonOffsetMs,
  type ForecastQualityGateResult,
  type ProviderQualityScore,
  type QualityField,
  type QualityHorizon,
  type QualityScoreBucket,
} from './forecast-quality-gates';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-quality-batch-runner is server-only and must not be imported in client code',
  );
}

// ── Concurrency helper ──────────────────────────────────────────────────────

const DEFAULT_BATCH_CONCURRENCY = 3;

async function runInChunks<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((it, j) => fn(it, i + j)));
    out.push(...results);
  }
  return out;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

/** A snapshot is "eligible" for quality gating once its h0 target has
 * elapsed past the 10-min publication grace. */
const HORIZON_PUBLISH_GRACE_MS = 10 * 60 * 1000;

function isSnapshotEligibleForGate(snap: CompactComparisonRun, nowMs: number): boolean {
  const runAtMs = Date.parse(snap.runAt);
  if (!Number.isFinite(runAtMs)) return false;
  return runAtMs + horizonOffsetMs('h0') + HORIZON_PUBLISH_GRACE_MS <= nowMs;
}

/** Pick the most recent eligible snapshot per seed city from a stored list. */
function pickLatestEligiblePerSeed(
  snapshots: CompactComparisonRun[],
  seeds: ForecastQualitySeedCity[],
  nowMs: number,
): Map<string, CompactComparisonRun> {
  const out = new Map<string, CompactComparisonRun>();
  // snapshots come back newest-first from listComparisonRuns().
  for (const s of snapshots) {
    if (!s.seedCityId) continue;
    if (!isSnapshotEligibleForGate(s, nowMs)) continue;
    if (out.has(s.seedCityId)) continue; // already have a newer one
    out.set(s.seedCityId, s);
  }
  // Filter the map to only seeds that exist in the current set.
  const seedIds = new Set(seeds.map((c) => c.id));
  for (const id of Array.from(out.keys())) if (!seedIds.has(id)) out.delete(id);
  return out;
}

// ── Phase 1: Seeded batch comparison ────────────────────────────────────────

export interface SeededBatchComparisonOptions {
  /** Days horizon passed to each comparison run. Defaults to 5. */
  days?: number;
  /** Concurrency. Defaults to 3. */
  concurrency?: number;
  /** Explicit opt-in for the BigQuery WeatherNext sample fetch (per-city). */
  includeWeatherNextSample?: boolean;
  /** Explicit opt-in for the Vertex AI WeatherNext production attempt. */
  includeWeatherNextProduction?: boolean;
  /** Subset of seed city ids to run; defaults to all. */
  seedCityIds?: string[];
}

export interface SeededBatchComparisonRow {
  cityId: string;
  cityLabel: string;
  ok: boolean;
  /** Snapshot id when ok === true. */
  snapshotId?: string;
  /** Compact summary of the produced run, for the immediate response. */
  providerCount?: number;
  durationMs: number;
  /** Failure note when ok === false. */
  failureMode?: string;
  notes: string[];
}

export interface SeededBatchComparisonResult {
  id: string;
  runAt: string;
  seedCityCount: number;
  rows: SeededBatchComparisonRow[];
  warnings: string[];
}

function newBatchId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runSeededBatchComparison(
  options: SeededBatchComparisonOptions = {},
): Promise<SeededBatchComparisonResult> {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? DEFAULT_BATCH_CONCURRENCY));
  const days = Math.max(1, Math.min(15, Math.floor(options.days ?? 5)));
  const allSeeds = FORECAST_QUALITY_SEED_CITIES;
  const seeds = options.seedCityIds && options.seedCityIds.length > 0
    ? allSeeds.filter((c) => options.seedCityIds!.includes(c.id))
    : allSeeds;

  const warnings: string[] = [];
  const rows = await runInChunks(seeds, concurrency, async (city) => {
    const start = Date.now();
    try {
      const run = await runProviderComparison({
        lat: city.lat,
        lon: city.lon,
        days,
        label: city.label,
        seedCityId: city.id,
        includeWeatherNextSample: options.includeWeatherNextSample,
        includeWeatherNextProduction: options.includeWeatherNextProduction,
      });
      const compact = toCompactRun(run);
      try {
        await recordComparisonRun(compact);
      } catch (err: any) {
        warnings.push(`${city.label}: snapshot persist failed — ${err?.message ?? err}`);
      }
      return {
        cityId: city.id,
        cityLabel: city.label,
        ok: true,
        snapshotId: compact.id,
        providerCount: compact.providerSummaries.length,
        durationMs: Date.now() - start,
        notes: [],
      } satisfies SeededBatchComparisonRow;
    } catch (err: any) {
      return {
        cityId: city.id,
        cityLabel: city.label,
        ok: false,
        durationMs: Date.now() - start,
        failureMode: 'seeded_comparison_error',
        notes: [String(err?.message ?? err)],
      } satisfies SeededBatchComparisonRow;
    }
  });

  return {
    id: newBatchId('sbc'),
    runAt: new Date().toISOString(),
    seedCityCount: seeds.length,
    rows,
    warnings,
  };
}

// ── Phase 2: Batch quality report ───────────────────────────────────────────

export type ProviderBucketCounts = Record<QualityScoreBucket, number>;

export interface ProviderFieldHorizonAggregate {
  cellsScored: number;
  buckets: ProviderBucketCounts;
  /** Mean absolute error across cells with a numeric error. Null when none. */
  meanAbsError: number | null;
}

export interface ProviderAggregateScore {
  provider: string;
  label: string;
  cellsScored: number;
  summary: ProviderBucketCounts;
  perField: Record<QualityField, ProviderFieldHorizonAggregate>;
  perHorizon: Record<QualityHorizon, ProviderFieldHorizonAggregate>;
  /** Number of cities (snapshots) this provider was scored across. */
  cityCount: number;
  /** Mean absolute temperature error (h0–h24). Surfaced to keep the cards readable. */
  meanTempErrorF: number | null;
}

export interface BatchQualityGateRow {
  cityId: string;
  cityLabel: string;
  comparisonSnapshotId: string;
  ok: boolean;
  qualityGateId?: string;
  warnings: string[];
}

export interface BatchQualityReport {
  id: string;
  runAt: string;
  seedCityCount: number;
  /** Number of seeds that had an eligible (gate-able) snapshot. */
  eligibleCityCount: number;
  /** Number of seeds whose gate produced provider scores. */
  scoredCityCount: number;
  rows: BatchQualityGateRow[];
  providerAggregates: ProviderAggregateScore[];
  topIssues: string[];
  warnings: string[];
}

function emptyBuckets(): ProviderBucketCounts {
  return { good: 0, acceptable: 0, weak: 0, unavailable: 0 };
}

function emptyAggregate(): ProviderFieldHorizonAggregate {
  return { cellsScored: 0, buckets: emptyBuckets(), meanAbsError: null };
}

function addBucket(target: ProviderBucketCounts, bucket: QualityScoreBucket) {
  target[bucket] += 1;
}

function aggregateGates(
  gates: Array<{ cityId: string; result: ForecastQualityGateResult }>,
): ProviderAggregateScore[] {
  const FIELDS: QualityField[] = ['temperature', 'windSpeed', 'windGust', 'precipitation'];
  const HORIZONS: QualityHorizon[] = ['h0', 'h6', 'h12', 'h24'];

  // provider id -> aggregator
  const acc = new Map<string, {
    label: string;
    summary: ProviderBucketCounts;
    perField: Record<QualityField, { sumAbs: number; nWithError: number; agg: ProviderFieldHorizonAggregate }>;
    perHorizon: Record<QualityHorizon, { sumAbs: number; nWithError: number; agg: ProviderFieldHorizonAggregate }>;
    cityIds: Set<string>;
    tempSumAbs: number;
    tempNWithError: number;
    cellsScored: number;
  }>();

  for (const { cityId, result } of gates) {
    for (const provider of result.providers) {
      let entry = acc.get(provider.provider);
      if (!entry) {
        const perField = {} as Record<QualityField, { sumAbs: number; nWithError: number; agg: ProviderFieldHorizonAggregate }>;
        for (const f of FIELDS) perField[f] = { sumAbs: 0, nWithError: 0, agg: emptyAggregate() };
        const perHorizon = {} as Record<QualityHorizon, { sumAbs: number; nWithError: number; agg: ProviderFieldHorizonAggregate }>;
        for (const h of HORIZONS) perHorizon[h] = { sumAbs: 0, nWithError: 0, agg: emptyAggregate() };
        entry = {
          label: provider.label,
          summary: emptyBuckets(),
          perField,
          perHorizon,
          cityIds: new Set<string>(),
          tempSumAbs: 0,
          tempNWithError: 0,
          cellsScored: 0,
        };
        acc.set(provider.provider, entry);
      }
      entry.cityIds.add(cityId);
      for (const cell of provider.scores) {
        addBucket(entry.summary, cell.bucket);
        addBucket(entry.perField[cell.field].agg.buckets, cell.bucket);
        addBucket(entry.perHorizon[cell.horizon].agg.buckets, cell.bucket);
        entry.perField[cell.field].agg.cellsScored += 1;
        entry.perHorizon[cell.horizon].agg.cellsScored += 1;
        entry.cellsScored += 1;
        if (cell.absError !== null) {
          entry.perField[cell.field].sumAbs += cell.absError;
          entry.perField[cell.field].nWithError += 1;
          entry.perHorizon[cell.horizon].sumAbs += cell.absError;
          entry.perHorizon[cell.horizon].nWithError += 1;
          if (cell.field === 'temperature') {
            entry.tempSumAbs += cell.absError;
            entry.tempNWithError += 1;
          }
        }
      }
    }
  }

  const out: ProviderAggregateScore[] = [];
  for (const [provider, entry] of acc) {
    for (const f of FIELDS) {
      const slot = entry.perField[f];
      slot.agg.meanAbsError = slot.nWithError > 0 ? Math.round((slot.sumAbs / slot.nWithError) * 10) / 10 : null;
    }
    for (const h of HORIZONS) {
      const slot = entry.perHorizon[h];
      slot.agg.meanAbsError = slot.nWithError > 0 ? Math.round((slot.sumAbs / slot.nWithError) * 10) / 10 : null;
    }
    const perFieldOut = {} as Record<QualityField, ProviderFieldHorizonAggregate>;
    for (const f of FIELDS) perFieldOut[f] = entry.perField[f].agg;
    const perHorizonOut = {} as Record<QualityHorizon, ProviderFieldHorizonAggregate>;
    for (const h of HORIZONS) perHorizonOut[h] = entry.perHorizon[h].agg;
    out.push({
      provider,
      label: entry.label,
      cellsScored: entry.cellsScored,
      summary: entry.summary,
      perField: perFieldOut,
      perHorizon: perHorizonOut,
      cityCount: entry.cityIds.size,
      meanTempErrorF: entry.tempNWithError > 0 ? Math.round((entry.tempSumAbs / entry.tempNWithError) * 10) / 10 : null,
    });
  }
  return out;
}

function buildTopIssues(
  aggregates: ProviderAggregateScore[],
  rows: BatchQualityGateRow[],
): string[] {
  const issues: string[] = [];
  const failedRows = rows.filter((r) => !r.ok);
  if (failedRows.length > 0) {
    issues.push(`${failedRows.length} seed city/cities had a quality-gate failure (see warnings).`);
  }
  for (const agg of aggregates) {
    const total = agg.summary.good + agg.summary.acceptable + agg.summary.weak;
    if (total === 0) continue;
    const weakPct = Math.round((agg.summary.weak / total) * 100);
    if (weakPct >= 30) {
      issues.push(`${agg.label}: ${weakPct}% of scored cells were "weak" — investigate.`);
    }
    if (agg.meanTempErrorF !== null && agg.meanTempErrorF >= 5) {
      issues.push(`${agg.label}: mean absolute temperature error is ${agg.meanTempErrorF}°F across ${agg.cityCount} city/cities.`);
    }
  }
  return issues.slice(0, 6);
}

export interface RunBatchQualityReportOptions {
  /** How many recent comparison snapshots to scan for eligibility. Defaults to 200 (the store cap). */
  scanLimit?: number;
  /** Concurrency for per-city quality gate runs. Defaults to 3. */
  concurrency?: number;
  /** Override "now" for tests. */
  nowMs?: number;
}

export async function runBatchQualityReport(
  options: RunBatchQualityReportOptions = {},
): Promise<BatchQualityReport> {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? DEFAULT_BATCH_CONCURRENCY));
  const scanLimit = Math.max(1, Math.min(200, options.scanLimit ?? 200));
  const nowMs = options.nowMs ?? Date.now();

  const seeds = FORECAST_QUALITY_SEED_CITIES;
  const recent = await listComparisonRuns(scanLimit);
  const eligibleBySeed = pickLatestEligiblePerSeed(recent, seeds, nowMs);
  const eligibleEntries = Array.from(eligibleBySeed.entries());

  const warnings: string[] = [];

  const gateOutputs = await runInChunks(eligibleEntries, concurrency, async ([seedId, snap]) => {
    const seed = seeds.find((s) => s.id === seedId);
    const cityLabel = seed?.label ?? snap.label ?? `(${snap.lat.toFixed(2)}, ${snap.lon.toFixed(2)})`;
    try {
      const result = await runQualityGate({ comparisonSnapshotId: snap.id, nowMs });
      // Persist gate result so the operator can dive in from the regular Quality Gates tab.
      const worthKeeping = result.providers.length > 0 || result.elapsedHorizons.length > 0;
      if (worthKeeping) {
        try {
          await recordQualityGateResult(result);
        } catch (err: any) {
          warnings.push(`${cityLabel}: gate persist failed — ${err?.message ?? err}`);
        }
      }
      const row: BatchQualityGateRow = {
        cityId: seedId,
        cityLabel,
        comparisonSnapshotId: snap.id,
        ok: result.providers.length > 0,
        qualityGateId: result.id,
        warnings: result.warnings,
      };
      return { row, result };
    } catch (err: any) {
      const row: BatchQualityGateRow = {
        cityId: seedId,
        cityLabel,
        comparisonSnapshotId: snap.id,
        ok: false,
        warnings: [String(err?.message ?? err)],
      };
      return { row, result: null as ForecastQualityGateResult | null };
    }
  });

  const rows: BatchQualityGateRow[] = gateOutputs.map((g) => g.row);
  const gatesForAggregation = gateOutputs
    .filter((g): g is { row: BatchQualityGateRow; result: ForecastQualityGateResult } => !!g.result && g.row.ok)
    .map((g) => ({ cityId: g.row.cityId, result: g.result }));

  const providerAggregates = aggregateGates(gatesForAggregation);
  const scoredCityCount = new Set(gatesForAggregation.map((g) => g.cityId)).size;

  if (eligibleEntries.length < seeds.length) {
    const missing = seeds.length - eligibleEntries.length;
    warnings.push(
      `${missing} seed city/cities had no eligible comparison snapshot (none old enough to score, or none found in store). Run a seeded batch comparison first, then retry after at least an hour.`,
    );
  }

  return {
    id: newBatchId('bqr'),
    runAt: new Date().toISOString(),
    seedCityCount: seeds.length,
    eligibleCityCount: eligibleEntries.length,
    scoredCityCount,
    rows,
    providerAggregates,
    topIssues: buildTopIssues(providerAggregates, rows),
    warnings,
  };
}
