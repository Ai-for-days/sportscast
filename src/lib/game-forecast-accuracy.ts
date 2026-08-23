// ── Post-game forecast accuracy write-up ─────────────────────────────────
//
// Per Derek: once a Weatherboard game goes final, show a neutral write-up of
// how close our forecast was to what actually happened. Two pieces:
//
//  1. A SNAPSHOT of what we predicted for kickoff, saved to Redis the last
//     time the game was rendered while still upcoming (`state === 'pre'`).
//     This has to be captured ahead of time — recomputing "the forecast" for
//     a past hour after the fact wouldn't reflect what was actually shown to
//     visitors, it would just reflect whatever the model backfilled in
//     hindsight, which is close to the actual outcome by construction and
//     would make every game look artificially accurate.
//  2. The ACTUAL observed conditions at kickoff, from the nearest NWS
//     station (fetchObservationNear in forecast-observed-floor.ts) — the
//     same settlement-truth source this site uses everywhere else.
//
// The resulting write-up is itself cached indefinitely once built (a final
// game's accuracy never changes), so a busy Weatherboard page never repeats
// the NWS lookup for the same game twice.

import { getRedis } from './redis';
import { resolveStation, fetchObservationNear } from './forecast-observed-floor';

export interface KickoffSnapshot {
  tempF: number;
  windSpeedMph: number;
  precipProbability: number;
  description: string;
}

const SNAPSHOT_TTL_SECONDS = 21 * 24 * 3600; // 21 days — comfortably covers "pre" through "final" for any tracked league
const SNAPSHOT_THROTTLE_TTL_SECONDS = 30 * 60; // refresh the snapshot at most every 30 minutes, no matter how much traffic a game's page gets
const WRITEUP_TTL_SECONDS = 60 * 24 * 3600; // 60 days — the answer never changes once computed
const WRITEUP_FAILURE_TTL_SECONDS = 600; // short backoff if NWS is down, so a busy page doesn't hammer it

function snapshotKey(gameId: string): string {
  return `game-forecast-snapshot:${gameId}`;
}
function snapshotThrottleKey(gameId: string): string {
  return `game-forecast-snapshot-throttle:${gameId}`;
}
function writeupKey(gameId: string): string {
  return `game-forecast-accuracy:${gameId}`;
}

/**
 * Save (or refresh) the kickoff forecast snapshot for an upcoming game.
 * Called on every 'pre' game render (a page can show the same upcoming game
 * to many visitors), so this self-throttles via a separate NX marker key —
 * at most one real write per game every 30 minutes — rather than spending a
 * Redis write on every single page view. The marker's own short TTL is what
 * makes this "at most every 30 min," not the snapshot's own (long) TTL.
 */
export async function saveKickoffSnapshot(gameId: string, snapshot: KickoffSnapshot): Promise<void> {
  try {
    const gotLock = await getRedis().set(snapshotThrottleKey(gameId), '1', { ex: SNAPSHOT_THROTTLE_TTL_SECONDS, nx: true });
    if (!gotLock) return; // another request already refreshed this snapshot recently
    await getRedis().set(snapshotKey(gameId), JSON.stringify(snapshot), { ex: SNAPSHOT_TTL_SECONDS });
  } catch {
    /* best-effort — a missing snapshot just means no accuracy write-up later */
  }
}

async function getKickoffSnapshot(gameId: string): Promise<KickoffSnapshot | null> {
  try {
    const raw = await getRedis().get(snapshotKey(gameId));
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as KickoffSnapshot;
  } catch {
    return null;
  }
}

function describeTempMiss(predicted: number, actual: number): string {
  const diff = Math.round(actual - predicted);
  if (Math.abs(diff) <= 2) return `We called the temperature almost exactly — forecast ${Math.round(predicted)}°F, actual ${Math.round(actual)}°F.`;
  const direction = diff > 0 ? 'cooler' : 'warmer';
  return `We forecast ${Math.round(predicted)}°F; it was actually ${Math.round(actual)}°F — our forecast ran ${Math.abs(diff)}° too ${direction === 'cooler' ? 'cool' : 'warm'}.`;
}

function describeWindMiss(predicted: number, actual: number | null): string | null {
  if (actual === null) return null;
  const diff = Math.round(actual - predicted);
  if (Math.abs(diff) <= 4) return `Wind was close to forecast — called ${Math.round(predicted)} mph, actual ${Math.round(actual)} mph.`;
  return `Wind ran ${Math.abs(diff)} mph ${diff > 0 ? 'stronger' : 'lighter'} than forecast (called ${Math.round(predicted)} mph, actual ${Math.round(actual)} mph).`;
}

function describePrecipMiss(predictedChance: number, actualPrecipMm: number | null): string | null {
  const actuallyRained = actualPrecipMm !== null && actualPrecipMm > 0.2; // > ~0.008in, filters out trace/sensor noise
  if (actualPrecipMm === null) return null;
  if (actuallyRained && predictedChance >= 50) return `We gave a ${predictedChance}% chance of precipitation, and it did come down — good call.`;
  if (actuallyRained && predictedChance < 50) return `We only gave a ${predictedChance}% chance of precipitation, but it rained anyway.`;
  if (!actuallyRained && predictedChance >= 50) return `We gave a ${predictedChance}% chance of precipitation; it stayed dry.`;
  return null; // low chance + stayed dry is the unremarkable/expected case — no need to call it out
}

/** Build (or return the cached) write-up comparing kickoff forecast to actual conditions for a now-final game. Returns null if there's no snapshot to compare against, or the venue's NWS station/observation can't be resolved. */
export async function getForecastAccuracyWriteup(
  gameId: string,
  venue: { lat: number; lon: number },
  kickoffUTC: string,
): Promise<string | null> {
  try {
    const cached = await getRedis().get(writeupKey(gameId));
    if (cached) return cached === 'none' ? null : (cached as string);
  } catch {
    /* fall through and try to build it */
  }

  const snapshot = await getKickoffSnapshot(gameId);
  if (!snapshot) return null; // never saw this game while it was upcoming (e.g. shipped after it started) — nothing to compare

  const kickoffMs = Date.parse(kickoffUTC);
  if (!Number.isFinite(kickoffMs)) return null;

  const stationId = await resolveStation(venue.lat, venue.lon);
  if (!stationId) {
    await cacheWriteup(gameId, null, WRITEUP_FAILURE_TTL_SECONDS);
    return null;
  }
  const actual = await fetchObservationNear(stationId, kickoffMs);
  if (!actual) {
    await cacheWriteup(gameId, null, WRITEUP_FAILURE_TTL_SECONDS);
    return null;
  }

  const parts = [
    describeTempMiss(snapshot.tempF, actual.tempF),
    describeWindMiss(snapshot.windSpeedMph, actual.windSpeedMph),
    describePrecipMiss(snapshot.precipProbability, actual.precipMmLastHour),
  ].filter((p): p is string => !!p);
  const writeup = parts.join(' ');

  await cacheWriteup(gameId, writeup, WRITEUP_TTL_SECONDS);
  return writeup;
}

async function cacheWriteup(gameId: string, writeup: string | null, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(writeupKey(gameId), writeup ?? 'none', { ex: ttlSeconds });
  } catch {
    /* best-effort */
  }
}

// ── Actual conditions (no forecast to compare against) ───────────────────
//
// Per Derek (2026-08-22): a finished game showing "82°/64° · 14mph wind ·
// 58% precip." is wrong — that's the day's FORECAST (a precip *chance* makes
// no sense once the game already happened), and it's what every finished
// game shows unless getForecastAccuracyWriteup() above found a snapshot.
// Most finished games never will: getForecast()'s hourly array is
// deliberately trimmed to "current hour onward" everywhere else in the app
// (the live "rest of today" forecast a visitor sees), so by the time a game
// is checked, its own kickoff hour has already fallen out of that array —
// there's no forecast data left to build a narrative from, snapshot or not.
//
// The fix isn't a snapshot at all here — it's the same NWS-observation path
// getForecastAccuracyWriteup uses, just without a forecast to compare it to.
// This runs for every finished game that never got a snapshot (i.e. nearly
// all of them, including every game that already existed before this
// feature shipped), so "how was the weather during the game" now has a real
// answer instead of stale forecast language.

const ACTUAL_KEY_TTL_SECONDS = WRITEUP_TTL_SECONDS; // same "never changes once computed" reasoning
const ACTUAL_FAILURE_TTL_SECONDS = WRITEUP_FAILURE_TTL_SECONDS;

function actualKey(gameId: string): string {
  return `game-actual-conditions:${gameId}`;
}

/** Build (or return the cached) plain statement of what conditions actually were at kickoff for a now-final game — used when there's no forecast snapshot to build a full accuracy write-up from. Returns null if the venue's NWS station/observation can't be resolved. */
export async function getActualConditionsSummary(
  gameId: string,
  venue: { lat: number; lon: number },
  kickoffUTC: string,
): Promise<string | null> {
  try {
    const cached = await getRedis().get(actualKey(gameId));
    if (cached) return cached === 'none' ? null : (cached as string);
  } catch {
    /* fall through and try to build it */
  }

  const kickoffMs = Date.parse(kickoffUTC);
  if (!Number.isFinite(kickoffMs)) return null;

  const stationId = await resolveStation(venue.lat, venue.lon);
  if (!stationId) {
    await cacheActual(gameId, null, ACTUAL_FAILURE_TTL_SECONDS);
    return null;
  }
  const actual = await fetchObservationNear(stationId, kickoffMs);
  if (!actual) {
    await cacheActual(gameId, null, ACTUAL_FAILURE_TTL_SECONDS);
    return null;
  }

  const wet = actual.precipMmLastHour !== null && actual.precipMmLastHour > 0.2;
  const summary = `Actual conditions at kickoff: ${Math.round(actual.tempF)}°F${actual.windSpeedMph !== null ? `, wind ${Math.round(actual.windSpeedMph)} mph` : ''}${wet ? ', precipitation observed' : ''}${actual.textDescription ? ` (${actual.textDescription})` : ''}.`;

  await cacheActual(gameId, summary, ACTUAL_KEY_TTL_SECONDS);
  return summary;
}

async function cacheActual(gameId: string, summary: string | null, ttlSeconds: number): Promise<void> {
  try {
    await getRedis().set(actualKey(gameId), summary ?? 'none', { ex: ttlSeconds });
  } catch {
    /* best-effort */
  }
}
