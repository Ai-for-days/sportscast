// ── Observed floor for today's high/low ──────────────────────────────────────
//
// Every source feeding the daily high/low is a FORECAST — Open-Meteo, NWS and
// AccuWeather all predict. Once the day is under way that is no longer the best
// information available: the ground has already recorded temperatures.
//
// Reported 2026-07-27 for 29209: the page showed "Today expect a high of 93°F"
// at 5:51 PM while the nearest station had already measured 95°F earlier that
// afternoon. A forecast high the day has demonstrably already beaten reads as
// broken, and on a wagering site it undermines the numbers next to it.
//
// So after the consensus blend, today's high is floored at the highest
// temperature actually observed so far, and today's low is capped at the
// lowest. Future days are untouched — they are still genuinely forecasts.
//
// Bulletproof by construction: every failure path returns the input unchanged.

import type { ForecastResponse, DailyForecast } from './types';

const NWS_HEADERS = {
  'User-Agent': 'WagerOnWeather/1.0 (contact@wageronweather.com)',
  Accept: 'application/geo+json',
};
const TIMEOUT_MS = 4000;
const STATION_TTL_MS = 24 * 60 * 60 * 1000; // a location's nearest station is stable
const OBS_TTL_MS = 10 * 60 * 1000; // stations report every 20-60 min

type Extremes = { maxF: number; minF: number } | null;

const stationCache = new Map<string, { id: string | null; at: number }>();
const obsCache = new Map<string, { value: Extremes; at: number }>();

function cacheKey(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      p,
      new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
    ]);
  } catch {
    return fallback;
  }
}

/**
 * Apply observed extremes to a daily array. Pure — the network lives in the
 * caller, so this is directly testable.
 *
 * Today's high can only move UP (the day already reached it) and today's low
 * can only move DOWN. Neither is allowed to contradict what was measured.
 */
export function applyObservedExtremes(daily: DailyForecast[], observed: Extremes): DailyForecast[] {
  if (!observed || !daily.length) return daily;
  const { maxF, minF } = observed;
  if (!isFinite(maxF) || !isFinite(minF)) return daily;

  const today = { ...daily[0] };
  today.highF = Math.max(today.highF, Math.round(maxF));
  today.lowF = Math.min(today.lowF, Math.round(minF));
  return [today, ...daily.slice(1)];
}

/** Resolve the nearest reporting station for a point, cached. Null when non-US or unavailable. Exported for reuse by precip-history.ts (same station, different observed metric). */
export async function resolveStation(lat: number, lon: number): Promise<string | null> {
  const key = cacheKey(lat, lon);
  const hit = stationCache.get(key);
  if (hit && Date.now() - hit.at < STATION_TTL_MS) return hit.id;

  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS },
    );
    if (!pointsRes.ok) return null; // non-US or API error — don't cache a transient failure
    const stationsUrl = (await pointsRes.json())?.properties?.observationStations;
    if (!stationsUrl) return null;

    const stationsRes = await fetch(stationsUrl, { headers: NWS_HEADERS });
    if (!stationsRes.ok) return null;
    const id = (await stationsRes.json())?.features?.[0]?.properties?.stationIdentifier ?? null;

    if (id) stationCache.set(key, { id, at: Date.now() });
    return id;
  } catch {
    return null;
  }
}

/**
 * Highest and lowest temperature this station has actually recorded during the
 * local day so far. `localDate` is YYYY-MM-DD in the location's own timezone,
 * which is what Open-Meteo returns (timezone=auto).
 */
async function fetchObservedExtremes(
  stationId: string,
  localDate: string,
  utcOffsetSeconds: number,
): Promise<Extremes> {
  const key = `${stationId}:${localDate}`;
  const hit = obsCache.get(key);
  if (hit && Date.now() - hit.at < OBS_TTL_MS) return hit.value;

  try {
    // Local midnight expressed in UTC. Parsing the date as UTC and subtracting
    // the location's offset avoids the server's own timezone leaking in.
    const startMs = Date.parse(`${localDate}T00:00:00Z`) - utcOffsetSeconds * 1000;
    if (!isFinite(startMs)) return null;
    const endMs = Math.min(startMs + 24 * 60 * 60 * 1000 - 1000, Date.now());
    if (endMs <= startMs) return null; // the local day hasn't started yet

    const url = `https://api.weather.gov/stations/${stationId}/observations`
      + `?start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
    const res = await fetch(url, { headers: NWS_HEADERS });
    if (!res.ok) return null;

    const features = (await res.json())?.features ?? [];
    let maxF = -Infinity;
    let minF = Infinity;
    for (const f of features) {
      const c = f?.properties?.temperature?.value;
      if (typeof c !== 'number') continue;
      const f2 = (c * 9) / 5 + 32;
      if (f2 > maxF) maxF = f2;
      if (f2 < minF) minF = f2;
    }
    const value: Extremes = isFinite(maxF) && isFinite(minF) ? { maxF, minF } : null;
    obsCache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

/**
 * Floor today's high (and cap today's low) with what has already been measured.
 * Runs AFTER the consensus blend — otherwise the blend could pull the number
 * back below an observation that has already happened.
 */
export async function applyObservedFloor(
  base: ForecastResponse,
  lat: number,
  lon: number,
): Promise<ForecastResponse> {
  if (!base?.daily?.length) return base;

  try {
    const stationId = await withTimeout(resolveStation(lat, lon), TIMEOUT_MS, null);
    if (!stationId) return base;

    const observed = await withTimeout(
      fetchObservedExtremes(stationId, base.daily[0].date, base.utcOffsetSeconds ?? 0),
      TIMEOUT_MS,
      null,
    );
    if (!observed) return base;

    const daily = applyObservedExtremes(base.daily, observed);
    if (daily === base.daily) return base;
    return { ...base, daily };
  } catch {
    return base; // never let this break a forecast
  }
}

/** Test seam. */
export function clearObservedFloorCaches() {
  stationCache.clear();
  obsCache.clear();
}

// ── Point-in-time observation (for post-game forecast-accuracy write-ups) ──
//
// Unlike fetchObservedExtremes above (today's running high/low), this finds
// the single station observation closest to an arbitrary past instant — used
// to compare "what we predicted at kickoff" against "what actually happened
// at kickoff" once a game goes final. Works for any past date the station
// still has history for (NWS keeps observations for weeks), not just today.

export interface PointObservation {
  tempF: number;
  windSpeedMph: number | null;
  /** mm of precipitation in the hour before this observation, when reported. */
  precipMmLastHour: number | null;
  textDescription: string | null;
}

const pointObsCache = new Map<string, { value: PointObservation | null; at: number }>();
const POINT_OBS_TTL_MS = 60 * 60 * 1000; // an hour — these are for PAST instants, so the answer never changes; this just bounds in-memory growth

/**
 * The station observation closest to `targetMs`, searched within
 * +/-`windowMinutes` of it. Null if the station has nothing in that window
 * (outage, or too far in the past/future for the station's retention).
 */
export async function fetchObservationNear(
  stationId: string,
  targetMs: number,
  windowMinutes = 45,
): Promise<PointObservation | null> {
  const key = `${stationId}:${targetMs}`;
  const hit = pointObsCache.get(key);
  if (hit && Date.now() - hit.at < POINT_OBS_TTL_MS) return hit.value;

  try {
    const windowMs = windowMinutes * 60 * 1000;
    const startMs = targetMs - windowMs;
    const endMs = Math.min(targetMs + windowMs, Date.now());
    if (endMs <= startMs) return null;

    const url = `https://api.weather.gov/stations/${stationId}/observations`
      + `?start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
    const res = await fetch(url, { headers: NWS_HEADERS });
    if (!res.ok) return null;

    const features = (await res.json())?.features ?? [];
    let best: { diffMs: number; obs: PointObservation } | null = null;
    for (const f of features) {
      const timeMs = Date.parse(f?.properties?.timestamp ?? '');
      const tempC = f?.properties?.temperature?.value;
      if (!Number.isFinite(timeMs) || typeof tempC !== 'number') continue;
      const diffMs = Math.abs(timeMs - targetMs);
      if (best && diffMs >= best.diffMs) continue;

      const windKmh = f?.properties?.windSpeed?.value;
      const precipMm = f?.properties?.precipitationLastHour?.value;
      best = {
        diffMs,
        obs: {
          tempF: (tempC * 9) / 5 + 32,
          windSpeedMph: typeof windKmh === 'number' ? windKmh * 0.621371 : null,
          precipMmLastHour: typeof precipMm === 'number' ? precipMm : null,
          textDescription: f?.properties?.textDescription ?? null,
        },
      };
    }
    const value = best?.obs ?? null;
    pointObsCache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}
