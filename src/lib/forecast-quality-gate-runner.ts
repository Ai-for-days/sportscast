// ── Step 137: Forecast quality gate runner (server-only) ────────────────────
//
// Orchestrates the retrospective scoring of one stored comparison snapshot
// against official NWS observations. Per-provider, per-horizon, per-field
// isolation — a missing observation, a missing forecast value, or a
// horizon that hasn't elapsed yet are all classified as `unavailable`
// rather than thrown errors.
//
// Settlement boundary (enforced):
//   - This runner READS from `nws-observations.ts` only. It does not call
//     `nws-grading.ts` or any settlement workflow.
//   - It writes nothing to the wager / bet / wallet stores.
//   - It writes a compact admin-only score record via the
//     forecast-quality-gate-store and an audit event via the
//     platform audit-log.

import { resolveNWSStation } from './forecast-tracker-store';
import { fetchDayObservations, type NWSRawObservation } from './nws-observations';
import { getComparisonRun } from './forecast-provider-comparison-store';
import {
  horizonOffsetMs,
  horizonLabel,
  listElapsedHorizons,
  findClosestObservation,
  scoreProvider,
  providerScoringInputs,
  type ForecastQualityGateResult,
  type ForecastQualityObservationMatch,
  type ProviderQualityScore,
  type QualityHorizon,
  type HorizonObservationContext,
} from './forecast-quality-gates';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-quality-gate-runner is server-only and must not be imported in client code',
  );
}

const ALL_HORIZONS: QualityHorizon[] = ['h0', 'h6', 'h12', 'h24'];

function newGateId(): string {
  return `fqg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueDates(runAtMs: number, horizons: QualityHorizon[]): string[] {
  const dates = new Set<string>();
  for (const h of horizons) {
    const target = new Date(runAtMs + horizonOffsetMs(h));
    dates.add(target.toISOString().slice(0, 10));
  }
  // Always include the snapshot's own day, in case h0 is the only elapsed
  // horizon and lives at runAt's calendar date.
  dates.add(new Date(runAtMs).toISOString().slice(0, 10));
  return Array.from(dates).sort();
}

async function fetchObservationsForHorizons(
  stationId: string,
  timeZone: string | undefined,
  runAtMs: number,
  horizons: QualityHorizon[],
): Promise<{ observations: NWSRawObservation[]; sourceNotes: string[] }> {
  const sourceNotes: string[] = [];
  const dates = uniqueDates(runAtMs, horizons);
  const all: NWSRawObservation[] = [];
  for (const date of dates) {
    try {
      const dayObs = await fetchDayObservations(stationId, date, timeZone);
      all.push(...dayObs);
    } catch (err: any) {
      sourceNotes.push(`Observation fetch failed for ${date} at ${stationId}: ${err?.message ?? 'unknown'}`);
    }
  }
  // Dedupe by timestamp (some stations publish overlapping records around midnight).
  const seen = new Set<string>();
  const deduped: NWSRawObservation[] = [];
  for (const o of all) {
    if (seen.has(o.time)) continue;
    seen.add(o.time);
    deduped.push(o);
  }
  return { observations: deduped, sourceNotes };
}

export interface RunQualityGateOptions {
  comparisonSnapshotId: string;
  /** Override "now" for tests. */
  nowMs?: number;
}

function buildEmptyResult(
  comparisonSnapshotId: string,
  warnings: string[],
): ForecastQualityGateResult {
  return {
    id: newGateId(),
    comparisonSnapshotId,
    comparisonRunAt: '',
    scoredAt: new Date().toISOString(),
    lat: 0,
    lon: 0,
    elapsedHorizons: [],
    observationSourceNotes: [],
    observationMatches: [],
    providers: [],
    warnings,
  };
}

export async function runQualityGate(opts: RunQualityGateOptions): Promise<ForecastQualityGateResult> {
  const snap = await getComparisonRun(opts.comparisonSnapshotId);
  if (!snap) {
    return buildEmptyResult(opts.comparisonSnapshotId, [
      `Comparison snapshot not found: ${opts.comparisonSnapshotId}`,
    ]);
  }

  const runAtMs = Date.parse(snap.runAt);
  if (!Number.isFinite(runAtMs)) {
    return {
      ...buildEmptyResult(opts.comparisonSnapshotId, ['Snapshot runAt is unparseable.']),
      lat: snap.lat,
      lon: snap.lon,
      label: snap.label,
      comparisonRunAt: snap.runAt,
    };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const elapsed = listElapsedHorizons(runAtMs, nowMs);
  const warnings: string[] = [];

  if (elapsed.length === 0) {
    return {
      id: newGateId(),
      comparisonSnapshotId: snap.id,
      comparisonRunAt: snap.runAt,
      scoredAt: new Date(nowMs).toISOString(),
      lat: snap.lat,
      lon: snap.lon,
      label: snap.label,
      elapsedHorizons: [],
      observationSourceNotes: [],
      observationMatches: [],
      providers: [],
      warnings: [
        'Too early to score — no forecast horizons have elapsed yet. Wait at least an hour after the snapshot, then try again.',
      ],
    };
  }

  // Resolve NWS station.
  let stationId: string | undefined;
  let timeZone: string | undefined;
  try {
    const r = await resolveNWSStation(snap.lat, snap.lon);
    stationId = r.stationId;
    timeZone = r.timeZone;
  } catch (err: any) {
    return {
      id: newGateId(),
      comparisonSnapshotId: snap.id,
      comparisonRunAt: snap.runAt,
      scoredAt: new Date(nowMs).toISOString(),
      lat: snap.lat,
      lon: snap.lon,
      label: snap.label,
      elapsedHorizons: elapsed,
      observationSourceNotes: [`Could not resolve NWS station: ${err?.message ?? 'unknown'}`],
      observationMatches: [],
      providers: [],
      warnings: ['NWS station resolution failed — quality gate cannot score this snapshot.'],
    };
  }

  // Fetch observations covering the elapsed horizons (and the snapshot's own day).
  const { observations, sourceNotes } = await fetchObservationsForHorizons(
    stationId!,
    timeZone,
    runAtMs,
    elapsed,
  );

  if (observations.length === 0) {
    return {
      id: newGateId(),
      comparisonSnapshotId: snap.id,
      comparisonRunAt: snap.runAt,
      scoredAt: new Date(nowMs).toISOString(),
      lat: snap.lat,
      lon: snap.lon,
      label: snap.label,
      stationId,
      elapsedHorizons: elapsed,
      observationSourceNotes: sourceNotes.length > 0 ? sourceNotes : [`No observations available from ${stationId}.`],
      observationMatches: [],
      providers: [],
      warnings: [`No NWS observations available from station ${stationId} for the snapshot window.`],
    };
  }

  // Build per-horizon observation match contexts.
  const matches: ForecastQualityObservationMatch[] = [];
  const contexts: HorizonObservationContext[] = ALL_HORIZONS.map((h) => {
    const targetMs = runAtMs + horizonOffsetMs(h);
    const isFuture = !elapsed.includes(h);
    const targetIso = new Date(targetMs).toISOString();
    if (isFuture) {
      matches.push({
        horizon: h,
        targetIso,
        matchedIso: null,
        matchOffsetMinutes: null,
        observedTempF: null,
        observedWindMph: null,
        observedGustMph: null,
      });
      return { horizon: h, isFutureHorizon: true, observed: undefined, matchOffsetMs: null };
    }
    const m = findClosestObservation(observations, targetMs);
    if (!m) {
      matches.push({
        horizon: h,
        targetIso,
        matchedIso: null,
        matchOffsetMinutes: null,
        observedTempF: null,
        observedWindMph: null,
        observedGustMph: null,
      });
      return { horizon: h, isFutureHorizon: false, observed: undefined, matchOffsetMs: null };
    }
    matches.push({
      horizon: h,
      targetIso,
      matchedIso: m.obs.time,
      matchOffsetMinutes: Math.round(m.offsetMs / 60000),
      observedTempF: m.obs.tempF ?? null,
      observedWindMph: m.obs.windMph ?? null,
      observedGustMph: m.obs.gustMph ?? null,
    });
    return {
      horizon: h,
      isFutureHorizon: false,
      observed: { tempF: m.obs.tempF, windMph: m.obs.windMph, gustMph: m.obs.gustMph },
      matchOffsetMs: m.offsetMs,
    };
  });

  // Score each provider against the observation contexts.
  const inputs = providerScoringInputs(snap);
  const providers: ProviderQualityScore[] = inputs.map((p) => scoreProvider(p, contexts));

  // Snapshot predates Step 137 horizon-value capture — flag it.
  if (!snap.providerHorizonValues || Object.keys(snap.providerHorizonValues).length === 0) {
    warnings.push(
      'This snapshot was captured before Step 137 horizon-value persistence — only the comparison summary is available. Re-run a comparison and try the gate again to get full scoring.',
    );
  }

  return {
    id: newGateId(),
    comparisonSnapshotId: snap.id,
    comparisonRunAt: snap.runAt,
    scoredAt: new Date(nowMs).toISOString(),
    lat: snap.lat,
    lon: snap.lon,
    label: snap.label,
    stationId,
    elapsedHorizons: elapsed,
    observationSourceNotes: sourceNotes,
    observationMatches: matches,
    providers,
    warnings,
  };
}
