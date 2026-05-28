// ── Step 166: Forecast divergence watch (brief + digest helper) ──────────
//
// Bridges the Step 165 divergence engine to the Step 159 daily brief and
// Step 160 digest renderer. Walks a bounded slice of recent saved ideas
// (Step 146 store) and runs `calculateForecastDivergence` per side of
// each idea using historical snapshots from the Step-132
// `forecast-revision-store`. **Reuses the Step 165 engine — does not
// duplicate scoring logic.**
//
// **Admin-only. Read-only.** No writes to any store, no
// publish/grade/settlement/wallet/Kalshi/Polymarket calls. Wrapped in
// try/catch at the call site (in `weather-market-daily-brief.ts`) so a
// failure cleanly degrades a section instead of 500-ing the brief.

import { listSavedIdeas, type SavedWeatherMarketIdea } from './weather-market-idea-store';
import { listSnapshots, locationKey } from './forecast-revision-store';
import {
  calculateForecastDivergence,
  type DivergenceMetric,
  type DivergenceSnapshotValue,
  type ForecastDivergenceResult,
  type RiskLevel,
  type StabilityLabel,
} from './forecast-divergence';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-divergence-watch is server-only and must not be imported in client code',
  );
}

// ── Tunables ───────────────────────────────────────────────────────────────

/** Cap on how many recent saved ideas we walk per build. Bounds Redis cost. */
const MAX_IDEAS_TO_ANALYZE = 15;
/** Cap on the returned watch list. */
const MAX_WATCH_RESULTS = 8;
/** Skip ideas whose target date is further out than this. */
const MAX_HORIZON_DAYS = 10;
/** Snapshots requested per location — Step 165 store cap is 30. */
const SNAPSHOTS_PER_LOCATION = 12;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ForecastDivergenceWatchEntry {
  /** Stable id used for React keys + audit. */
  id: string;
  cityName: string;
  targetDate: string;
  metric: DivergenceMetric;
  /** Saved-idea id that surfaced this candidate. */
  sourceIdeaId: string;
  /** Idea-side this entry refers to. */
  side: 'A' | 'B';
  /** Full Step-165 result for the (location, date, metric). */
  result: ForecastDivergenceResult;
}

export interface BuildWatchOptions {
  /** Inject "now" for tests. */
  now?: Date;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function daysUntilTarget(targetDate: string, now: number): number {
  const t = Date.parse(`${targetDate}T12:00:00Z`);
  if (!Number.isFinite(t)) return -1;
  return Math.round((t - now) / (24 * 60 * 60 * 1000));
}

function ideaMetricToDivergence(m: string | undefined): DivergenceMetric | null {
  if (m === 'daily_high') return 'high_temp';
  if (m === 'daily_low') return 'low_temp';
  return null;
}

function projectSnapshotsForMetric(
  snapshots: Awaited<ReturnType<typeof listSnapshots>>,
  targetDate: string,
  metric: DivergenceMetric,
): DivergenceSnapshotValue[] {
  const out: DivergenceSnapshotValue[] = [];
  for (const snap of snapshots) {
    const day = snap.daily?.find((d) => d.date === targetDate);
    if (!day) continue;
    let value: number;
    switch (metric) {
      case 'high_temp':
        value = day.highF;
        break;
      case 'low_temp':
        value = day.lowF;
        break;
      case 'precipitation_probability':
        value = day.precipProbability;
        break;
      case 'wind_speed':
        value = day.windSpeedMph;
        break;
    }
    if (!Number.isFinite(value)) continue;
    out.push({ forecastTime: snap.generatedAt, value });
  }
  return out;
}

function isTrivial(result: ForecastDivergenceResult): boolean {
  // Only suppress entries where every signal is at the calmest setting.
  return (
    result.stabilityLabel === 'stable' &&
    result.opportunitySignal === 'low' &&
    result.settlementRisk === 'low'
  );
}

const OPPORTUNITY_WEIGHT: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };
const STABILITY_WEIGHT: Record<StabilityLabel, number> = {
  highly_unstable: 4,
  unstable: 3,
  watch: 2,
  stable: 1,
};
/** Higher means "comes later" — used so high settlement risk sorts after low when other keys tie. */
const SETTLEMENT_ASC: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

function sortPerStep166(
  entries: ForecastDivergenceWatchEntry[],
): ForecastDivergenceWatchEntry[] {
  return entries.slice().sort((a, b) => {
    const oa = OPPORTUNITY_WEIGHT[a.result.opportunitySignal];
    const ob = OPPORTUNITY_WEIGHT[b.result.opportunitySignal];
    if (ob !== oa) return ob - oa;
    const sa = STABILITY_WEIGHT[a.result.stabilityLabel];
    const sb = STABILITY_WEIGHT[b.result.stabilityLabel];
    if (sb !== sa) return sb - sa;
    if (b.result.divergenceScore !== a.result.divergenceScore) {
      return b.result.divergenceScore - a.result.divergenceScore;
    }
    if (b.result.volatilityScore !== a.result.volatilityScore) {
      return b.result.volatilityScore - a.result.volatilityScore;
    }
    // Settlement-risk ascending — high settlement risk demoted on tie.
    return SETTLEMENT_ASC[a.result.settlementRisk] - SETTLEMENT_ASC[b.result.settlementRisk];
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Pull recent active saved ideas, run the Step 165 engine against each
 * side, return the top-N most operator-actionable entries. **Never
 * throws** — falls back to an empty list on Redis failure.
 */
export async function buildForecastDivergenceWatch(
  options: BuildWatchOptions = {},
): Promise<ForecastDivergenceWatchEntry[]> {
  const nowMs = (options.now ?? new Date()).getTime();

  let savedIdeas: SavedWeatherMarketIdea[] = [];
  try {
    savedIdeas = await listSavedIdeas({ limit: 50 });
  } catch {
    return [];
  }

  const active = savedIdeas
    .filter((s) => s.status !== 'rejected')
    .slice(0, MAX_IDEAS_TO_ANALYZE);
  if (active.length === 0) return [];

  // Per-locationKey memoization within this build — multiple ideas in
  // the same city pair don't pay the Redis cost twice.
  const snapshotCache = new Map<string, Awaited<ReturnType<typeof listSnapshots>>>();

  const collected: ForecastDivergenceWatchEntry[] = [];

  for (const saved of active) {
    const idea = saved.idea;
    if (!idea?.targetDate) continue;
    const daysOut = daysUntilTarget(idea.targetDate, nowMs);
    if (daysOut < 0 || daysOut > MAX_HORIZON_DAYS) continue;

    const sides: Array<{ side: 'A' | 'B'; loc: any; rawMetric: string }> = [
      { side: 'A', loc: idea.locationA, rawMetric: idea.metricA },
      { side: 'B', loc: idea.locationB, rawMetric: idea.metricB },
    ];

    for (const { side, loc, rawMetric } of sides) {
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') continue;
      const metric = ideaMetricToDivergence(rawMetric);
      if (!metric) continue;

      const locKey = locationKey({ lat: loc.lat, lon: loc.lon });
      let snapshots = snapshotCache.get(locKey);
      if (!snapshots) {
        try {
          snapshots = await listSnapshots(locKey, SNAPSHOTS_PER_LOCATION);
        } catch {
          continue;
        }
        snapshotCache.set(locKey, snapshots);
      }
      if (snapshots.length < 2) continue;

      const projected = projectSnapshotsForMetric(snapshots, idea.targetDate, metric);
      if (projected.length < 2) continue;

      const result = calculateForecastDivergence({
        cityName: loc.label,
        targetDate: idea.targetDate,
        metric,
        snapshots: projected,
        daysUntilTarget: daysOut,
      });
      if (isTrivial(result)) continue;

      collected.push({
        id: `dw-${saved.id}-${side}-${metric}`,
        cityName: loc.label,
        targetDate: idea.targetDate,
        metric,
        sourceIdeaId: saved.id,
        side,
        result,
      });
    }
  }

  const sorted = sortPerStep166(collected);
  return sorted.slice(0, MAX_WATCH_RESULTS);
}
