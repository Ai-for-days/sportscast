// ── Post-game forecast accuracy write-up ─────────────────────────────────
//
// Per Derek: once a Weatherboard game goes final, show a neutral write-up of
// how close our forecast was to what actually happened. Two pieces:
//
//  1. What we predicted for kickoff — ideally a SNAPSHOT saved to Redis the
//     last time the game was rendered while still upcoming (`state ===
//     'pre'`); that's the ground truth of what a visitor actually saw. When
//     no snapshot exists (predates the mechanism, or the game was never
//     viewed pre-kickoff), fetchBackfilledSnapshot (historical-forecast.ts)
//     reconstructs an honest equivalent from Open-Meteo's archived model
//     output at a fixed 24h lead time — NOT by recomputing "the forecast"
//     for a past hour today, which would just reflect whatever the model
//     backfilled in hindsight (close to the actual outcome by construction,
//     making every game look artificially accurate).
//  2. The ACTUAL observed conditions at kickoff, from the nearest NWS
//     station (fetchObservationNear in forecast-observed-floor.ts) — the
//     same settlement-truth source this site uses everywhere else.
//
// The resulting write-up is itself cached indefinitely once built (a final
// game's accuracy never changes), so a busy Weatherboard page never repeats
// the NWS lookup for the same game twice.

import { getRedis } from './redis';
import { resolveStation, fetchObservationNear } from './forecast-observed-floor';
import { fetchBackfilledSnapshot } from './historical-forecast';

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

// Per Derek (2026-08-23): this should read as an honest self-reflection in
// Wager on Weather's own voice — "our forecast had called for X and here's
// how it actually went" — not a clinical forecast/actual table. The brand
// name anchors the first (always-present) sentence; the rest stays in a
// casual "we" voice so it doesn't repeat awkwardly across all three misses.
function describeTempMiss(predicted: number, actual: number): string {
  const diff = Math.round(actual - predicted);
  const p = Math.round(predicted);
  const a = Math.round(actual);
  if (Math.abs(diff) <= 2) return `Wager on Weather's forecast had called for ${p}°F, and we nailed it — it came in right around ${a}°F.`;
  if (diff > 0) return `Wager on Weather's forecast had called for ${p}°F, but it ended up warmer at ${a}°F — we ran ${diff}° cold on that one.`;
  return `Wager on Weather's forecast had called for ${p}°F, but it only reached ${a}°F — we were a bit warm on that call, off by ${Math.abs(diff)}°.`;
}

function describeWindMiss(predicted: number, actual: number | null): string | null {
  if (actual === null) return null;
  const diff = Math.round(actual - predicted);
  const p = Math.round(predicted);
  const a = Math.round(actual);
  if (Math.abs(diff) <= 4) return `Wind held right where we called it — ${p} mph forecast, ${a} mph actual.`;
  if (diff > 0) return `We undersold the wind a bit — called for ${p} mph, but it blew closer to ${a} mph.`;
  return `We were a little aggressive on the wind call — forecast ${p} mph, but it stayed calmer at ${a} mph.`;
}

function describePrecipMiss(predictedChance: number, actualPrecipMm: number | null): string | null {
  const actuallyRained = actualPrecipMm !== null && actualPrecipMm > 0.2; // > ~0.008in, filters out trace/sensor noise
  if (actualPrecipMm === null) return null;
  if (actuallyRained && predictedChance >= 50) return `Good call on the rain — we gave it a ${predictedChance}% chance, and it came down.`;
  if (actuallyRained && predictedChance < 50) return `We undersold the rain risk — only gave it a ${predictedChance}% chance, but it rained anyway.`;
  if (!actuallyRained && predictedChance >= 50) return `We were a little ambitious on the precipitation call — gave it a ${predictedChance}% chance, but it stayed dry.`;
  return null; // low chance + stayed dry is the unremarkable/expected case — no need to call it out
}

/** Build (or return the cached) write-up comparing kickoff forecast to actual conditions for a now-final game. Falls back to a reconstructed historical forecast (historical-forecast.ts) when no live snapshot was ever saved — see that file for why this isn't hindsight. Returns null only if that also fails, or the venue's NWS station/observation can't be resolved. */
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

  let snapshot = await getKickoffSnapshot(gameId);
  if (!snapshot) {
    // Never saw this game while it was upcoming (predates the snapshot
    // mechanism, or shipped after it started) — reconstruct an honest
    // pre-game forecast from Open-Meteo's archived model output instead of
    // giving up. See historical-forecast.ts for why this isn't hindsight.
    snapshot = await fetchBackfilledSnapshot(venue.lat, venue.lon, kickoffUTC);
    if (!snapshot) return null;
  }

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
