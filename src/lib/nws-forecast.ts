// ── NWS forecast helper ─────────────────────────────────────────────────
//
// Wraps the National Weather Service forecast endpoint
// (https://api.weather.gov/gridpoints/{office}/{x},{y}/forecast). Two-hop
// flow: first hit /points/{lat},{lon} to get the gridpoint's forecast
// URL, then GET that URL for 7 days of day/night forecast periods.
//
// Server-only. Used by /api/admin/forecast-tracker/auto-pull to pre-fill
// the Forecast Tracker form so operators don't have to type NWS values
// by hand.

import { recordSourceSuccess, recordSourceFailure } from './data-source-health';

const NWS_UA = 'WagerOnWeather/1.0';

/**
 * Is an NWS HTTP status an OUTAGE, or just the edge of its coverage?
 *
 * api.weather.gov is US-only, and it answers a location it does not cover
 * with a 404. Four tracked venues sit outside it (Rogers Centre and the three
 * Canadian MLS sides — see NON_US_VENUE_IDS in auto-market-shared.ts), and a
 * 404 for one of those is a permanent, known, correct answer. Counting it as
 * a failure would page an operator about NWS being down every time someone
 * loaded a Toronto page, which is exactly how an alarm gets ignored.
 *
 * Pure and exported so the distinction is pinned by a test.
 */
export function isNwsOutageStatus(status: number): boolean {
  return status !== 404;
}

/**
 * Run an NWS call and report what happened to the health tracker, then hand
 * the result (or the error) straight back to the caller. Every consumer here
 * already catches and degrades quietly, which is precisely why this has to
 * report before the error disappears into a fallback.
 */
async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    await recordSourceSuccess('nws');
    return result;
  } catch (err) {
    const message = String((err as any)?.message ?? err);
    const status = Number(message.match(/returned (\d{3})/)?.[1] ?? NaN);
    if (!Number.isFinite(status) || isNwsOutageStatus(status)) {
      await recordSourceFailure('nws', message);
    }
    throw err;
  }
}

export interface NWSForecastPeriod {
  /** 1-based period index in the forecast (1 = next period, 2 = the
   *  one after, etc.). */
  number: number;
  /** Human label like "Tonight", "Wednesday", "Wednesday Night". */
  name: string;
  /** ISO 8601 timestamp for the start of the period. */
  startTime: string;
  endTime: string;
  /** True for daytime period (typically used for daily highs), false
   *  for nighttime (lows). */
  isDaytime: boolean;
  /** Temperature in `temperatureUnit` (NWS US offices return °F). */
  temperature: number;
  temperatureUnit: 'F' | 'C';
  /** Free-text wind speed like "5 to 10 mph" or "5 mph". */
  windSpeed: string;
  /** Short narrative like "Sunny" or "Chance Showers". */
  shortForecast: string;
}

// ── Gridpoint (/points) cache ───────────────────────────────────────────
//
// The /points → gridpoint mapping is fixed geography: a given lat/lon
// always resolves to the same office/grid cell, so the response is
// safely cacheable for the life of the process. Without this, every
// caller paid TWO /points round trips per location (once for the daily
// fetch, once for the hourly one), which is what pushed the weather
// market idea generator — 75 cities behind a 60s function limit —
// over its budget once NWS blending landed in `applyConsensus`.
//
// Cached in-module (per warm serverless instance). Failures are NOT
// cached, so a transient NWS outage can't poison the map. Bounded to
// keep a long-lived instance from growing without limit.

interface NWSGridpointUrls {
  forecast?: string;
  forecastHourly?: string;
}

const POINTS_CACHE = new Map<string, NWSGridpointUrls>();
const POINTS_CACHE_MAX = 500;

/** ~11m precision, matching what we send to NWS, so cache keys and
 *  requests can never disagree. */
function pointsKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/**
 * Resolve (and memoize) the gridpoint forecast URLs for a lat/lon.
 * One /points call serves both the daily and hourly fetchers.
 */
async function getGridpointUrls(lat: number, lon: number): Promise<NWSGridpointUrls> {
  const key = pointsKey(lat, lon);
  const hit = POINTS_CACHE.get(key);
  if (hit) return hit;

  const pointsRes = await fetch(`https://api.weather.gov/points/${key}`, {
    headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' },
  });
  if (!pointsRes.ok) {
    throw new Error(`NWS points API returned ${pointsRes.status}`);
  }
  const pointsData = await pointsRes.json();
  const urls: NWSGridpointUrls = {
    forecast: pointsData?.properties?.forecast as string | undefined,
    forecastHourly: pointsData?.properties?.forecastHourly as string | undefined,
  };

  // Only cache a response that actually carried a usable URL.
  if (urls.forecast || urls.forecastHourly) {
    if (POINTS_CACHE.size >= POINTS_CACHE_MAX) {
      // Simple FIFO eviction — the key set is small and stable in practice.
      const oldest = POINTS_CACHE.keys().next().value;
      if (oldest !== undefined) POINTS_CACHE.delete(oldest);
    }
    POINTS_CACHE.set(key, urls);
  }
  return urls;
}

/** Test/ops escape hatch — drop the memoized gridpoint mappings. */
export function clearNWSPointsCache(): void {
  POINTS_CACHE.clear();
}

/**
 * Fetch the 7-day day/night forecast for a lat/lon. Falls back to an
 * empty array on any error.
 */
export async function fetchNWSForecast(
  lat: number,
  lon: number,
): Promise<NWSForecastPeriod[]> {
  const { forecast: forecastUrl } = await getGridpointUrls(lat, lon);
  if (!forecastUrl) {
    throw new Error('NWS points response missing forecast URL');
  }
  const fcRes = await fetch(forecastUrl, {
    headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' },
  });
  if (!fcRes.ok) {
    throw new Error(`NWS forecast API returned ${fcRes.status}`);
  }
  const fcData = await fcRes.json();
  const periods = fcData?.properties?.periods;
  if (!Array.isArray(periods)) return [];
  return periods as NWSForecastPeriod[];
}

/**
 * Fetch the NWS hourly forecast for a lat/lon. Uses the
 * `forecastHourly` URL on the gridpoint, which returns ~156 1-hour
 * periods (about 6.5 days). Each period has the same shape as
 * NWSForecastPeriod but covers exactly one hour, with isDaytime
 * reflecting whether that hour is in daylight.
 */
export async function fetchNWSHourlyForecast(
  lat: number,
  lon: number,
): Promise<NWSForecastPeriod[]> {
  return tracked(async () => {
  const { forecastHourly: hourlyUrl } = await getGridpointUrls(lat, lon);
  if (!hourlyUrl) {
    throw new Error('NWS points response missing forecastHourly URL');
  }
  const fcRes = await fetch(hourlyUrl, {
    headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' },
  });
  if (!fcRes.ok) {
    throw new Error(`NWS hourly forecast API returned ${fcRes.status}`);
  }
  const fcData = await fcRes.json();
  const periods = fcData?.properties?.periods;
  if (!Array.isArray(periods)) return [];
  return periods as NWSForecastPeriod[];
  });
}

/** Parse the first integer out of a wind-speed string like "5 to 10 mph".
 *  Returns undefined when nothing parseable. */
export function parseNwsWindSpeedMph(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  // Prefer the upper bound of a range ("5 to 10 mph" -> 10) since
  // operators care about the wagerable max.
  const range = s.match(/(\d+)\s*to\s*(\d+)/i);
  if (range) {
    const a = parseFloat(range[1]);
    const b = parseFloat(range[2]);
    return Math.max(a, b);
  }
  const single = s.match(/(\d+(?:\.\d+)?)/);
  if (single) {
    return parseFloat(single[1]);
  }
  return undefined;
}
