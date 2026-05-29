// ── Forecast Tracker auto-pull ───────────────────────────────────────────
//
// Pre-fills the Forecast Tracker form with values from Open-Meteo and
// the National Weather Service so operators don't have to manually
// type forecasts. The endpoint geocodes the location once, then queries
// both providers in parallel and returns a per-source value for the
// requested metric.
//
// Read-only. The operator still has to click Submit on the tracker form
// to persist the entries — this just fills the inputs.

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getOpenMeteoForecast } from '../../../../lib/open-meteo';
import { fetchNWSForecast, parseNwsWindSpeedMph } from '../../../../lib/nws-forecast';

export const prerender = false;

const VALID_METRICS = new Set([
  'high_temp',
  'low_temp',
  'actual_temp',
  'wind_speed',
  'wind_gust',
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

async function geocodeLocation(locationName: string): Promise<{ lat: number; lon: number }> {
  const trimmed = locationName.trim();
  const { searchLocal, lookupZip } = await import('../../../../lib/zip-lookup');
  if (/^\d{5}$/.test(trimmed)) {
    const result = lookupZip(trimmed);
    if (result) return { lat: result.lat, lon: result.lon };
  }
  const localResults = searchLocal(trimmed);
  if (localResults.length > 0) {
    return { lat: localResults[0].lat, lon: localResults[0].lon };
  }
  const encoded = encodeURIComponent(trimmed);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encoded}&countrycodes=us&format=json&limit=1`,
    { headers: { 'User-Agent': 'WagerOnWeather/1.0' } },
  );
  if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Location not found: "${locationName}"`);
  }
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

function pickOpenMeteoValue(
  metric: string,
  targetDate: string,
  targetTime: string | undefined,
  forecast: any,
): number | null {
  // Daily metrics — find the daily entry whose date matches.
  if (metric === 'high_temp' || metric === 'low_temp') {
    const day = (forecast.daily ?? []).find((d: any) => d.date === targetDate);
    if (!day) return null;
    return metric === 'high_temp' ? day.highF ?? null : day.lowF ?? null;
  }
  // Daily wind metrics without a target time — use the max for the day.
  if ((metric === 'wind_speed' || metric === 'wind_gust') && !targetTime) {
    const day = (forecast.daily ?? []).find((d: any) => d.date === targetDate);
    if (!day) return null;
    return metric === 'wind_speed' ? day.windSpeedMph ?? null : day.windGustMph ?? null;
  }
  // Hourly metrics — find hourly entry matching date + time.
  if (targetTime) {
    const target = `${targetDate}T${targetTime}`;
    const hour = (forecast.hourly ?? []).find(
      (h: any) => typeof h.time === 'string' && h.time.startsWith(target),
    );
    if (!hour) return null;
    if (metric === 'actual_temp') return hour.tempF ?? null;
    if (metric === 'wind_speed') return hour.windSpeedMph ?? null;
    if (metric === 'wind_gust') return hour.windGustMph ?? null;
  }
  return null;
}

function pickNwsValue(
  metric: string,
  targetDate: string,
  periods: any[],
): number | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  // Each period covers a half-day. Find the one whose start date matches
  // and whose isDaytime flag matches the metric semantics:
  //   high_temp → daytime period (the day's high)
  //   low_temp  → nighttime period (the night's low)
  // For wind metrics, take the daytime period as a single-source signal.
  const matchDate = (p: any) =>
    typeof p.startTime === 'string' && p.startTime.startsWith(targetDate);
  if (metric === 'high_temp') {
    const day = periods.find((p) => matchDate(p) && p.isDaytime === true);
    return day && typeof day.temperature === 'number' ? day.temperature : null;
  }
  if (metric === 'low_temp') {
    const night = periods.find((p) => matchDate(p) && p.isDaytime === false);
    return night && typeof night.temperature === 'number' ? night.temperature : null;
  }
  if (metric === 'wind_speed' || metric === 'wind_gust') {
    const day = periods.find((p) => matchDate(p) && p.isDaytime === true);
    if (!day) return null;
    return parseNwsWindSpeedMph(day.windSpeed) ?? null;
  }
  // NWS forecast periods don't include hourly point-time data without an
  // additional gridpoint call — leave actual_temp unsupported for now.
  return null;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return json({ error: 'unauthorized' }, 401);

  const locationName = url.searchParams.get('locationName');
  const metric = url.searchParams.get('metric');
  const targetDate = url.searchParams.get('targetDate');
  const targetTime = url.searchParams.get('targetTime') || undefined;

  if (!locationName || !metric || !targetDate) {
    return json(
      { error: 'locationName, metric, and targetDate are required' },
      400,
    );
  }
  if (!VALID_METRICS.has(metric)) {
    return json({ error: `Unsupported metric "${metric}"` }, 400);
  }

  let lat = 0;
  let lon = 0;
  try {
    const r = await geocodeLocation(locationName);
    lat = r.lat;
    lon = r.lon;
  } catch (err: any) {
    return json({ error: `Geocode failed: ${err?.message ?? err}` }, 404);
  }

  const warnings: string[] = [];
  let openMeteoValue: number | null = null;
  let nwsValue: number | null = null;

  // Open-Meteo (covers up to 16 days out).
  try {
    const forecast = await getOpenMeteoForecast(lat, lon, 16);
    openMeteoValue = pickOpenMeteoValue(metric, targetDate, targetTime, forecast);
    if (openMeteoValue === null) {
      warnings.push(
        `Open-Meteo returned no value for ${metric} on ${targetDate}${targetTime ? `@${targetTime}` : ''} (likely out of the 16-day forecast horizon).`,
      );
    }
  } catch (err: any) {
    warnings.push(`Open-Meteo error: ${err?.message ?? err}`);
  }

  // NWS (covers ~7 days out for forecast periods).
  try {
    const periods = await fetchNWSForecast(lat, lon);
    nwsValue = pickNwsValue(metric, targetDate, periods);
    if (nwsValue === null) {
      warnings.push(
        `NWS returned no value for ${metric} on ${targetDate} (likely out of the 7-day forecast horizon, or hourly metric like actual_temp needs a separate gridpoint call).`,
      );
    }
  } catch (err: any) {
    warnings.push(`NWS error: ${err?.message ?? err}`);
  }

  return json({
    locationName,
    metric,
    targetDate,
    targetTime: targetTime ?? null,
    lat: parseFloat(lat.toFixed(4)),
    lon: parseFloat(lon.toFixed(4)),
    values: {
      wageronweather: openMeteoValue,
      nws: nwsValue,
    },
    warnings,
  });
};
