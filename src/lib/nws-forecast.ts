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

const NWS_UA = 'WagerOnWeather/1.0';

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

/**
 * Fetch the 7-day day/night forecast for a lat/lon. Falls back to an
 * empty array on any error.
 */
export async function fetchNWSForecast(
  lat: number,
  lon: number,
): Promise<NWSForecastPeriod[]> {
  const pointsRes = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' } },
  );
  if (!pointsRes.ok) {
    throw new Error(`NWS points API returned ${pointsRes.status}`);
  }
  const pointsData = await pointsRes.json();
  const forecastUrl = pointsData?.properties?.forecast as string | undefined;
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
  const pointsRes = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers: { 'User-Agent': NWS_UA, Accept: 'application/geo+json' } },
  );
  if (!pointsRes.ok) {
    throw new Error(`NWS points API returned ${pointsRes.status}`);
  }
  const pointsData = await pointsRes.json();
  const hourlyUrl = pointsData?.properties?.forecastHourly as string | undefined;
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
