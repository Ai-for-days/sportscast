// ── Step 130: Forecast revision snapshot store (server-only) ────────────────
//
// Persists compact snapshots of the public forecast so we can detect when
// the next 5–7 day outlook for a location has actually changed since the
// last view. Pure read-only customer-facing intelligence — no betting,
// pricing, settlement, or PII.
//
// Snapshots are deduped by `generatedAt`: if the upstream forecast hasn't
// produced a new run since the last snapshot for this location, we skip
// the write. Bounded retention per location keeps Redis usage flat.
//
// Key shape:
//   forecast-revision-snapshot:<id>
//   forecast-revision-snapshots:<locationKey>   (sorted set, score = ts ms)
//
// See docs/forecast-intelligence-notes.md for the design rationale.

import { getRedis } from './redis';
import type { ForecastResponse } from './types';
import {
  buildForecastIntelligence,
  type ForecastIntelligenceSummary,
} from './forecast-intelligence';

if (typeof window !== 'undefined') {
  throw new Error(
    'forecast-revision-store is server-only and must not be imported in client code',
  );
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ForecastSnapshot {
  id: string;
  /** When we wrote the snapshot (ISO). */
  capturedAt: string;
  /** When the upstream forecast was generated (forecast.generatedAt). */
  generatedAt: string;
  locationKey: string;
  /** Next-7-day daily summary, in ascending date order. */
  daily: Array<{
    date: string;
    highF: number;
    lowF: number;
    precipProbability: number;
    windSpeedMph: number;
  }>;
  /** Whether any Severe/Extreme alert was active at capture time. */
  hasActiveSevereAlert: boolean;
  /** Compact embed of the Step 129 intelligence summary. */
  intelligence: ForecastIntelligenceSummary;
}

// ── Redis keys ──────────────────────────────────────────────────────────────

const KEY = {
  snapshot: (id: string) => `forecast-revision-snapshot:${id}`,
  byLocation: (locationKey: string) => `forecast-revision-snapshots:${locationKey}`,
};

const MAX_SNAPSHOTS_PER_LOCATION = 30;

// ── Location key normalization ──────────────────────────────────────────────

/**
 * Stable per-location key. Prefer the postal code; fall back to a coarsely
 * rounded lat,lon string so nearby coordinates collapse to the same series.
 */
export function locationKey(opts: {
  zip?: string;
  countryCode?: string;
  lat: number;
  lon: number;
}): string {
  if (opts.zip && opts.zip.trim()) {
    const cc = (opts.countryCode || 'us').toLowerCase();
    return `${cc}:${opts.zip.replace(/\s+/g, '').toLowerCase()}`;
  }
  // Round to ~1km to absorb minor lat/lon jitter from the Use My Location flow.
  return `coord:${opts.lat.toFixed(2)},${opts.lon.toFixed(2)}`;
}

// ── Build a compact snapshot from a ForecastResponse ────────────────────────

export function buildSnapshot(
  forecast: ForecastResponse,
  locKey: string,
  intelligence?: ForecastIntelligenceSummary,
): Omit<ForecastSnapshot, 'id'> {
  const intel = intelligence ?? buildForecastIntelligence(forecast);
  const daily = (forecast.daily ?? []).slice(0, 7).map((d) => ({
    date: d.date,
    highF: d.highF,
    lowF: d.lowF,
    precipProbability: d.precipProbability,
    windSpeedMph: d.windSpeedMph,
  }));
  return {
    capturedAt: new Date().toISOString(),
    generatedAt: forecast.generatedAt,
    locationKey: locKey,
    daily,
    hasActiveSevereAlert: intel.hasActiveSevereAlert,
    intelligence: intel,
  };
}

// ── Snapshot lifecycle ──────────────────────────────────────────────────────

function newSnapshotId(): string {
  return `frs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Read the most recent snapshot for a location, if any. */
export async function getLatestSnapshot(
  locKey: string,
): Promise<ForecastSnapshot | null> {
  const redis = getRedis();
  const ids = (await redis.zrange(KEY.byLocation(locKey), 0, 0, { rev: true })) as string[];
  if (!ids || ids.length === 0) return null;
  const raw = (await redis.get(KEY.snapshot(ids[0]))) as string | null;
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as ForecastSnapshot) : (raw as unknown as ForecastSnapshot);
  } catch {
    return null;
  }
}

/**
 * Persist a snapshot for this location, deduplicated by `generatedAt`. If the
 * latest snapshot already shares the same `generatedAt`, the write is skipped
 * and the existing snapshot is returned. Bounded retention is enforced.
 */
export async function recordSnapshotIfNew(
  payload: Omit<ForecastSnapshot, 'id'>,
): Promise<{ snapshot: ForecastSnapshot; wasWritten: boolean }> {
  const redis = getRedis();
  const latest = await getLatestSnapshot(payload.locationKey);
  if (latest && latest.generatedAt && payload.generatedAt && latest.generatedAt === payload.generatedAt) {
    return { snapshot: latest, wasWritten: false };
  }

  const snapshot: ForecastSnapshot = { id: newSnapshotId(), ...payload };
  const score = Date.parse(snapshot.capturedAt) || Date.now();
  const pipe = redis.pipeline();
  pipe.set(KEY.snapshot(snapshot.id), JSON.stringify(snapshot));
  pipe.zadd(KEY.byLocation(snapshot.locationKey), { score, member: snapshot.id });
  pipe.zremrangebyrank(
    KEY.byLocation(snapshot.locationKey),
    0,
    -MAX_SNAPSHOTS_PER_LOCATION - 1,
  );
  await pipe.exec();
  return { snapshot, wasWritten: true };
}

/**
 * Convenience: read prior snapshot, build current snapshot, persist current,
 * return both. Designed to be called once per page render.
 */
export async function captureRevision(
  forecast: ForecastResponse,
  locKey: string,
  intelligence?: ForecastIntelligenceSummary,
): Promise<{ prior: ForecastSnapshot | null; current: ForecastSnapshot }> {
  const prior = await getLatestSnapshot(locKey);
  const payload = buildSnapshot(forecast, locKey, intelligence);
  // If prior == latest by generatedAt, recordSnapshotIfNew returns the
  // existing latest snapshot. We still want a fresh comparison candidate.
  // The "current" snapshot in that case is the same as prior — meaning no
  // upstream revision happened, so the analyzer will report no changes.
  const { snapshot: current } = await recordSnapshotIfNew(payload);
  return { prior, current };
}
