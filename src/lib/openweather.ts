// ── OpenWeather daily forecast client (server-only, optional) ───────────────
//
// Phase 2: Fallback provider to Open-Meteo, and contributor to consensus
// forecast blending. Optional when OPENWEATHER_API_KEY is not configured;
// returns [] (no error) when unconfigured or on any fetch failure, so the
// consensus simply runs without OpenWeather. Free tier gives a 5-day daily
// forecast + ~1,000 calls/day, cached:
//   - daily forecast: 60 seconds (same as Open-Meteo for consistency)
//
// Also provides getOpenWeatherForecast() for the fallback chain: when
// Open-Meteo fails, tries to fetch a complete ForecastResponse from
// OpenWeather before falling back to synthetic data.
//
// OpenWeather API returns temps in Kelvin; we convert to °F.
// Daily highs/lows are derived from the 5-day forecast endpoint.

import { getRedis } from './redis';
import type { ForecastResponse, ForecastPoint, DailyForecast } from './types';
import { feelsLike, describeWeather, getWeatherIcon, reverseGeocode } from './weather-utils';
import { recordSourceSuccess, recordSourceFailure } from './data-source-health';

const FORECAST_TTL = 60; // 60 seconds, matching Open-Meteo cache

function apiKey(): string | null {
  const k =
    (import.meta as any).env?.OPENWEATHER_API_KEY ??
    (typeof process !== 'undefined' ? process.env?.OPENWEATHER_API_KEY : undefined);
  const v = k ? String(k).trim() : '';
  return v.length > 0 ? v : null;
}

/** True when an OpenWeather API key is configured. */
export function openWeatherConfigured(): boolean {
  return apiKey() !== null;
}

/** Kelvin to Fahrenheit conversion */
function kelvinToFahrenheit(k: number): number {
  return Math.round(((k - 273.15) * 9/5 + 32) * 10) / 10;
}

/** Kelvin to Celsius conversion */
function kelvinToCelsius(k: number): number {
  return Math.round((k - 273.15) * 10) / 10;
}

export interface OpenWeatherDaily {
  date: string; // YYYY-MM-DD
  highF: number;
  lowF: number;
}

/**
 * Fetch OpenWeather's 5-day daily high/low for a lat/lon. Returns [] on
 * any error or when no API key is configured — never throws.
 */
export async function fetchOpenWeatherDaily(lat: number, lon: number): Promise<OpenWeatherDaily[]> {
  const key = apiKey();
  if (!key) return [];

  try {
    const redis = getRedis();
    const cacheKey = `openweather:daily:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cachedRaw = await redis.get(cacheKey);
    if (cachedRaw) {
      const parsed = typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw;
      if (Array.isArray(parsed)) return parsed as OpenWeatherDaily[];
    }

    // OpenWeather free tier: 5-day forecast
    const url =
      `https://api.openweathermap.org/data/2.5/forecast` +
      `?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
      `&appid=${encodeURIComponent(key)}` +
      `&units=standard`; // standard = Kelvin

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) {
        await recordSourceFailure('openweather', `HTTP ${res.status}: Rate limited`);
      } else if (res.status >= 500) {
        await recordSourceFailure('openweather', `HTTP ${res.status}: Server error`);
      }
      return [];
    }

    const data: any = await res.json();
    if (!data?.list || !Array.isArray(data.list)) return [];

    // Group by date and extract daily hi/lo from the 3-hourly forecasts
    const byDate = new Map<string, { highs: number[]; lows: number[] }>();

    for (const item of data.list) {
      if (!item?.main?.temp) continue;
      const dateKey = new Date(item.dt * 1000).toISOString().slice(0, 10);
      const tempK = Number(item.main.temp);
      if (!Number.isFinite(tempK)) continue;

      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { highs: [], lows: [] });
      }
      const day = byDate.get(dateKey)!;
      day.highs.push(tempK);
      day.lows.push(tempK);
    }

    const out: OpenWeatherDaily[] = [];
    for (const [date, temps] of byDate) {
      if (temps.highs.length === 0) continue;
      out.push({
        date,
        highF: kelvinToFahrenheit(Math.max(...temps.highs)),
        lowF: kelvinToFahrenheit(Math.min(...temps.lows)),
      });
    }

    if (out.length) {
      await redis.set(cacheKey, JSON.stringify(out), { ex: FORECAST_TTL });
      await recordSourceSuccess('openweather');
    }
    return out;
  } catch (err) {
    await recordSourceFailure('openweather', String((err as any)?.message ?? err));
    return [];
  }
}

/**
 * Fetch a complete ForecastResponse from OpenWeather's 5-day forecast.
 * Used as a fallback when Open-Meteo fails.
 * Returns null on any error or when no API key is configured.
 */
export async function getOpenWeatherForecast(lat: number, lon: number, days: number): Promise<ForecastResponse | null> {
  const key = apiKey();
  if (!key) return null;

  try {
    const redis = getRedis();
    const cacheKey = `openweather:forecast:${lat.toFixed(3)},${lon.toFixed(3)}:${days}`;
    const cachedRaw = await redis.get(cacheKey);
    if (cachedRaw) {
      const parsed = typeof cachedRaw === 'string' ? JSON.parse(cachedRaw) : cachedRaw;
      await recordSourceSuccess('openweather');
      return parsed as ForecastResponse;
    }

    const url =
      `https://api.openweathermap.org/data/2.5/forecast` +
      `?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
      `&appid=${encodeURIComponent(key)}` +
      `&units=standard`; // standard = Kelvin

    const res = await fetch(url);
    if (!res.ok) {
      await recordSourceFailure('openweather', `HTTP ${res.status}`);
      return null;
    }

    const data: any = await res.json();
    if (!data?.list || !Array.isArray(data.list) || data.list.length === 0) {
      await recordSourceFailure('openweather', 'Empty forecast list');
      return null;
    }

    // Build hourly and daily forecasts from 3-hourly data
    const hourly: ForecastPoint[] = [];
    const byDate = new Map<string, { highs: number[]; lows: number[]; temps: ForecastPoint[] }>();

    for (const item of data.list) {
      if (!item?.main?.temp) continue;

      const dt = new Date(item.dt * 1000);
      const tempK = Number(item.main.temp);
      const humidity = Number(item.main.humidity ?? 50);
      const pressure = Math.round(Number(item.main.pressure ?? 1013));
      const cloudCover = Number(item.clouds?.all ?? 0);
      const precipMm = Number(item.rain?.['3h'] ?? item.snow?.['3h'] ?? 0);
      const windSpeedMph = Math.round((Number(item.wind?.speed ?? 0) || 0) * 2.237); // m/s to mph
      const windGustMph = Math.round((Number(item.wind?.gust ?? 0) || 0) * 2.237);
      const windDirDeg = Number(item.wind?.deg ?? 0);

      if (!Number.isFinite(tempK)) continue;

      const tempF = kelvinToFahrenheit(tempK);
      const tempC = kelvinToCelsius(tempK);
      const isNight = dt.getHours() < 6 || dt.getHours() >= 20;
      const condition = item.weather?.[0]?.main ?? 'Unknown';

      const pt: ForecastPoint = {
        time: dt.toISOString().replace('Z', ''),
        tempK,
        tempF,
        tempC,
        humidity,
        dewPointF: Math.round(tempF - ((100 - humidity) / 5)),
        precipMm: Math.round(precipMm * 10) / 10,
        precipProbability: Math.round((Number(item.pop ?? 0) || 0) * 100),
        windSpeedMph,
        windDirectionDeg: windDirDeg,
        windGustMph,
        cloudCover: Math.round(cloudCover),
        pressure,
        feelsLikeF: Math.round(feelsLike(tempF, humidity, windSpeedMph)),
        uvIndex: 0, // OpenWeather free tier doesn't provide UV
        visibility: 10,
        description: condition,
        icon: getWeatherIcon(condition, isNight),
      };

      hourly.push(pt);

      // Track daily hi/lo
      const dateKey = dt.toISOString().slice(0, 10);
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { highs: [], lows: [], temps: [] });
      }
      const day = byDate.get(dateKey)!;
      day.highs.push(tempF);
      day.lows.push(tempF);
      day.temps.push(pt);
    }

    // Trim to requested days
    const maxDate = new Date();
    maxDate.setUTCDate(maxDate.getUTCDate() + days);
    const maxDateStr = maxDate.toISOString().slice(0, 10);

    const daily: DailyForecast[] = [];
    for (const [date, day] of byDate) {
      if (date > maxDateStr || day.highs.length === 0) continue;

      const temps = day.temps;
      const midday = temps.find(t => new Date(t.time).getUTCHours() === 12) || temps[Math.floor(temps.length / 2)];

      daily.push({
        date,
        highF: Math.max(...day.highs),
        lowF: Math.min(...day.lows),
        feelsLikeHighF: Math.round((Math.max(...day.highs) - 32) * 5/9 * 0.8 * 9/5 + 32), // rough estimate
        feelsLikeLowF: Math.round((Math.min(...day.lows) - 32) * 5/9 * 0.8 * 9/5 + 32),
        precipMm: Math.round(temps.reduce((s, t) => s + (t.precipMm ?? 0), 0) * 10) / 10,
        precipProbability: Math.max(...temps.map(t => t.precipProbability)),
        windSpeedMph: Math.round(temps.reduce((s, t) => s + t.windSpeedMph, 0) / temps.length),
        windGustMph: Math.max(...temps.map(t => t.windGustMph)),
        humidity: Math.round(temps.reduce((s, t) => s + t.humidity, 0) / temps.length),
        uvIndexMax: 0,
        sunrise: '',
        sunset: '',
        description: midday?.description ?? 'Unknown',
        icon: midday?.icon ?? '',
        dayDescription: midday?.description ?? 'Unknown',
        nightDescription: midday?.description ?? 'Unknown',
      });
    }

    if (daily.length === 0) {
      await recordSourceFailure('openweather', 'No valid daily forecasts extracted');
      return null;
    }

    // Get location details
    const geo = await reverseGeocode(lat, lon);
    const utcOffsetSeconds = Math.round(lon / 15) * 3600;

    const forecast: ForecastResponse = {
      location: {
        lat,
        lon,
        name: geo.name,
        displayName: geo.displayName,
        state: geo.state,
        country: geo.country,
        zip: geo.zip,
      },
      current: hourly[0] || daily[0] as any,
      hourly: hourly.slice(0, Math.min(hourly.length, 240)), // Cap at ~10 days of 3-hourly
      daily: daily.slice(0, days),
      alerts: [],
      utcOffsetSeconds,
      generatedAt: new Date().toISOString(),
      source: {
        provider: 'open-meteo', // Keep as open-meteo for compatibility; consensus will override
        label: 'OpenWeather',
        isResearchSample: false,
        notes: 'OpenWeather API fallback for Open-Meteo',
      },
    };

    await redis.set(cacheKey, JSON.stringify(forecast), { ex: FORECAST_TTL });
    await recordSourceSuccess('openweather');
    return forecast;
  } catch (err) {
    await recordSourceFailure('openweather', String((err as any)?.message ?? err));
    return null;
  }
}
