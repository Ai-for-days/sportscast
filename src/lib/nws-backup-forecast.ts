// ── NWS backup forecast (2026-11-11) ────────────────────────────────────────
//
// When Open-Meteo refuses us (it rate-limits the free tier), the forecast used
// to fall straight through to OpenWeather, which was never switched on (no
// key), and then to SIMULATED weather that the market engines refuse to price.
// So a refused request meant that venue's markets were not priced that hour,
// and its pages served an old copy or "unavailable".
//
// Derek, 2026-11-11: "yes, NWS as the backup." NWS is free, needs no key, and
// covers every US venue. This builds a complete ForecastResponse from it:
//   - hourly: the NWS hourly product (temperature, dew point, humidity, wind,
//     chance of precipitation, conditions), about 6.5 days;
//   - precipitation amount, sky cover and gusts from the NWS gridded data;
//   - daily: high/low/precip/wind rolled up from those hours, with the NWS
//     day and night narratives as the descriptions;
//   - current: the first hour, with pressure and visibility from the nearest
//     station's latest observation.
//
// What NWS does not give us is left honest rather than invented: UV index 0,
// sunrise/sunset '' (the same gaps the OpenWeather fallback has). The horizon
// is ~6 days; getFullForecast fills the later days from the last real forecast
// when it has one (see spliceBackupWithLastGood).
//
// Returns 'no-coverage' for a point outside NWS coverage (it answers 404 for
// the Canadian venues, a known permanent absence, not an outage) and null on
// any other failure, so the caller moves on to the next fallback.

import type { DailyForecast, ForecastPoint, ForecastResponse } from './types';
import {
  fetchNWSPoint,
  fetchNWSHourlyForecast,
  fetchNWSForecast,
  fetchNWSGridData,
  fetchNWSLatestObservation,
  parseNwsWindSpeedMph,
  type NWSForecastPeriod,
  type NWSGridValue,
} from './nws-forecast';
import { feelsLike, getWeatherIcon } from './weather-utils';

const CARDINAL = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** "NW" -> 315. Pure, for tests. */
export function cardinalToDegrees(dir: string | undefined): number {
  const i = CARDINAL.indexOf(String(dir ?? '').trim().toUpperCase());
  return i < 0 ? 0 : i * 22.5;
}

/** Offset in seconds from an ISO string's own offset ("...-05:00" -> -18000). Pure. */
export function isoOffsetSeconds(iso: string): number | null {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return /Z$/.test(String(iso ?? '')) ? 0 : null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60);
}

/** The value a gridded layer holds for the UTC hour starting at ms (per-hour share for totals). */
function gridAt(layer: NWSGridValue[], ms: number, total = false): number | undefined {
  const v = layer.find((x) => ms >= x.startMs && ms < x.startMs + x.hours * 3600_000);
  if (!v) return undefined;
  return total ? v.value / v.hours : v.value;
}

const num = (x: any): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

/** Build hourly points from NWS hourly periods plus gridded layers. Pure, for tests. */
export function buildNwsHourly(
  periods: NWSForecastPeriod[],
  grid: Record<'qpf' | 'sky' | 'gust', NWSGridValue[]>,
  obs: { pressurePa?: number; visibilityM?: number } | null,
): ForecastPoint[] {
  const pressure = obs?.pressurePa ? Math.round(obs.pressurePa / 100) : 0;
  const visibility = obs?.visibilityM ? Math.round((obs.visibilityM / 1609.34) * 10) / 10 : 10;
  const out: ForecastPoint[] = [];
  for (const p of periods) {
    const tempF = num(p?.temperature);
    if (!p?.startTime || tempF === undefined) continue;
    const ms = Date.parse(p.startTime);
    if (!Number.isFinite(ms)) continue;
    const humidity = Math.round(num(p.relativeHumidity?.value) ?? 0);
    const dewC = num(p.dewpoint?.value);
    const windMph = parseNwsWindSpeedMph(p.windSpeed) ?? 0;
    const gustKmh = gridAt(grid.gust, ms);
    const qpf = gridAt(grid.qpf, ms, true);
    const sky = gridAt(grid.sky, ms);
    const tempC = Math.round(((tempF - 32) * 5) / 9);
    const condition = String(p.shortForecast ?? '').trim() || 'Unknown';
    out.push({
      // Location-local wall time without the offset, the same shape as Open-Meteo (timezone=auto).
      time: String(p.startTime).slice(0, 16),
      tempK: Math.round(((tempF - 32) * 5) / 9 + 273.15),
      tempF: Math.round(tempF),
      tempC,
      humidity,
      dewPointF: dewC === undefined ? Math.round(tempF) : Math.round((dewC * 9) / 5 + 32),
      precipMm: qpf === undefined ? 0 : Math.round(qpf * 10) / 10,
      precipProbability: Math.round(num(p.probabilityOfPrecipitation?.value) ?? 0),
      windSpeedMph: Math.round(windMph),
      windDirectionDeg: cardinalToDegrees(p.windDirection),
      windGustMph: Math.round(Math.max(windMph, gustKmh === undefined ? 0 : gustKmh / 1.609)),
      cloudCover: Math.round(sky ?? 0),
      pressure,
      feelsLikeF: Math.round(feelsLike(tempF, humidity, windMph)),
      uvIndex: 0,
      visibility,
      description: condition,
      icon: getWeatherIcon(condition, !p.isDaytime),
    });
  }
  return out;
}

/**
 * Roll hourly points up into days. A day needs 18+ hours to count, except the
 * first (today, already under way), so a half-covered last day never reports
 * an afternoon-only high as the day's high. Pure, for tests.
 */
export function buildNwsDaily(hourly: ForecastPoint[], periods: NWSForecastPeriod[]): DailyForecast[] {
  const byDate = new Map<string, ForecastPoint[]>();
  for (const h of hourly) {
    const d = h.time.slice(0, 10);
    byDate.set(d, [...(byDate.get(d) ?? []), h]);
  }
  const narrative = new Map<string, { day?: NWSForecastPeriod; night?: NWSForecastPeriod }>();
  for (const p of periods) {
    const d = String(p?.startTime ?? '').slice(0, 10);
    if (!d) continue;
    const e = narrative.get(d) ?? {};
    if (p.isDaytime) e.day = p;
    else e.night = p;
    narrative.set(d, e);
  }
  const dates = [...byDate.keys()].sort();
  const out: DailyForecast[] = [];
  dates.forEach((date, i) => {
    const hrs = byDate.get(date)!;
    if (i > 0 && hrs.length < 18) return;
    const temps = hrs.map((h) => h.tempF);
    const highF = Math.max(...temps);
    const lowF = Math.min(...temps);
    const feels = hrs.map((h) => h.feelsLikeF);
    const n = narrative.get(date);
    const noon = hrs.find((h) => h.time.slice(11, 13) === '13') ?? hrs[Math.floor(hrs.length / 2)];
    const headline = n?.day?.shortForecast?.trim() || noon.description;
    out.push({
      date,
      highF,
      lowF,
      feelsLikeHighF: Math.max(...feels),
      feelsLikeLowF: Math.min(...feels),
      precipMm: Math.round(hrs.reduce((s, h) => s + h.precipMm, 0) * 10) / 10,
      precipProbability: Math.max(...hrs.map((h) => h.precipProbability)),
      windSpeedMph: Math.max(...hrs.map((h) => h.windSpeedMph)),
      windGustMph: Math.max(...hrs.map((h) => h.windGustMph)),
      humidity: Math.round(hrs.reduce((s, h) => s + h.humidity, 0) / hrs.length),
      uvIndexMax: 0,
      sunrise: '',
      sunset: '',
      description: headline,
      icon: getWeatherIcon(headline, false),
      dayDescription: n?.day?.detailedForecast?.trim() || headline,
      nightDescription: n?.night?.detailedForecast?.trim() || n?.night?.shortForecast?.trim() || headline,
    });
  });
  return out;
}

/** A full forecast from NWS alone; 'no-coverage' outside the US; null when NWS fails. */
export async function getNwsBackupForecast(lat: number, lon: number): Promise<ForecastResponse | 'no-coverage' | null> {
  let point;
  try {
    point = await fetchNWSPoint(lat, lon);
  } catch (err) {
    return /returned 404/.test(String((err as any)?.message ?? err)) ? 'no-coverage' : null;
  }
  try {
    const [hourlyPeriods, dayPeriods, grid, obs] = await Promise.all([
      fetchNWSHourlyForecast(lat, lon),
      fetchNWSForecast(lat, lon).catch(() => [] as NWSForecastPeriod[]),
      fetchNWSGridData(lat, lon).catch(() => ({ qpf: [], sky: [], gust: [] })),
      fetchNWSLatestObservation(lat, lon).catch(() => null),
    ]);
    const hourly = buildNwsHourly(hourlyPeriods, grid, obs);
    if (hourly.length < 24) return null;
    const daily = buildNwsDaily(hourly, dayPeriods);
    if (!daily.length) return null;
    const utcOffsetSeconds = isoOffsetSeconds(hourlyPeriods[0]?.startTime ?? '') ?? 0;
    const name = point.city && point.state ? `${point.city}, ${point.state}` : undefined;
    return {
      location: { lat, lon, name: point.city, state: point.state, country: 'US', displayName: name },
      current: hourly[0],
      hourly,
      daily,
      alerts: [],
      utcOffsetSeconds,
      timeZone: point.timeZone,
      generatedAt: new Date().toISOString(),
      baseProvider: 'nws',
      source: {
        provider: 'open-meteo',
        label: 'NWS (Open-Meteo unavailable)',
        isResearchSample: false,
        notes: 'Open-Meteo refused or failed, so this forecast is built from the National Weather Service hourly forecast and gridded data.',
      },
    };
  } catch {
    return null;
  }
}

/**
 * The NWS backup reaches ~6 days; markets run two weeks out. Fill the days
 * after the backup's last day (and their hours) from the last real forecast,
 * so a refused Open-Meteo request does not blank days 7-16. Pure, for tests.
 */
export function spliceBackupWithLastGood(backup: ForecastResponse, lastGood: ForecastResponse | null): ForecastResponse {
  if (!lastGood?.daily?.length || lastGood.synthetic) return backup;
  const lastDate = backup.daily[backup.daily.length - 1]?.date;
  if (!lastDate) return backup;
  const tailDays = lastGood.daily.filter((d) => d.date > lastDate);
  if (!tailDays.length) return backup;
  const lastHour = backup.hourly[backup.hourly.length - 1]?.time ?? '';
  const tailHours = (lastGood.hourly ?? []).filter((h) => typeof h?.time === 'string' && h.time > lastHour);
  return {
    ...backup,
    daily: [...backup.daily, ...tailDays],
    hourly: [...backup.hourly, ...tailHours],
    source: backup.source && {
      ...backup.source,
      notes: `${backup.source.notes ?? ''} Days after ${lastDate} come from the last full forecast, generated ${lastGood.generatedAt}.`.trim(),
    },
  };
}
