// ── AccuWeather daily forecast client (server-only, optional) ───────────────
//
// Contributes daily high/low to the live consensus forecast. Entirely
// optional: with no ACCUWEATHER_API_KEY set, every function no-ops (returns
// []), so the consensus simply runs without AccuWeather. Free tier gives a
// 5-day daily forecast + ~50 calls/day, so we cache aggressively:
//   - location key (lat/lon → AccuWeather locationKey): 30 days
//   - daily forecast: 3 hours
//
// AccuWeather flow is two calls: geoposition search → locationKey, then the
// daily forecast for that key. Daily temps come back in °F (metric=false is
// the default).

import { getRedis } from './redis';

const LOCKEY_TTL = 60 * 60 * 24 * 30; // 30 days
const FORECAST_TTL = 60 * 60 * 3; // 3 hours

function apiKey(): string | null {
  const k =
    (import.meta as any).env?.ACCUWEATHER_API_KEY ??
    (typeof process !== 'undefined' ? process.env?.ACCUWEATHER_API_KEY : undefined);
  const v = k ? String(k).trim() : '';
  return v.length > 0 ? v : null;
}

/** True when an AccuWeather API key is configured. */
export function accuWeatherConfigured(): boolean {
  return apiKey() !== null;
}

export interface AccuDaily {
  date: string; // YYYY-MM-DD
  highF: number;
  lowF: number;
}

async function getLocationKey(lat: number, lon: number, key: string): Promise<string | null> {
  const redis = getRedis();
  const cacheKey = `accuweather:lockey:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = await redis.get(cacheKey);
  if (cached) return typeof cached === 'string' ? cached : String(cached);

  const url =
    `https://dataservice.accuweather.com/locations/v1/cities/geoposition/search` +
    `?apikey=${encodeURIComponent(key)}&q=${lat},${lon}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data: any = await res.json();
  const lk = data?.Key ? String(data.Key) : null;
  if (lk) await redis.set(cacheKey, lk, { ex: LOCKEY_TTL });
  return lk;
}

/**
 * Fetch AccuWeather's next-5-day daily high/low for a lat/lon. Returns [] on
 * any error or when no API key is configured — never throws.
 */
export async function fetchAccuWeatherDaily(lat: number, lon: number): Promise<AccuDaily[]> {
  const key = apiKey();
  if (!key) return [];
  try {
    const redis = getRedis();
    const fcCacheKey = `accuweather:daily:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cachedRaw = await redis.get(fcCacheKey);
    if (cachedRaw) {
      const parsed = typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw;
      if (Array.isArray(parsed)) return parsed as AccuDaily[];
    }

    const lk = await getLocationKey(lat, lon, key);
    if (!lk) return [];

    const url =
      `https://dataservice.accuweather.com/forecasts/v1/daily/5day/${encodeURIComponent(lk)}` +
      `?apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();

    const out: AccuDaily[] = (data?.DailyForecasts ?? [])
      .map((d: any) => ({
        date: String(d?.Date ?? '').slice(0, 10),
        highF: Math.round(Number(d?.Temperature?.Maximum?.Value)),
        lowF: Math.round(Number(d?.Temperature?.Minimum?.Value)),
      }))
      .filter((d: AccuDaily) => d.date && Number.isFinite(d.highF) && Number.isFinite(d.lowF));

    if (out.length) await redis.set(fcCacheKey, JSON.stringify(out), { ex: FORECAST_TTL });
    return out;
  } catch {
    return [];
  }
}
