// ── Live consensus forecast ─────────────────────────────────────────────────
//
// Blends the daily high/low of the live public forecast across every source
// we can fetch in real time, presented as the WagerOnWeather forecast:
//   - Open-Meteo  (always — it's the base/skeleton; provides current, hourly,
//                  air quality, allergy, the full 15-day tail, etc.)
//   - NWS         (free; ~7-day day/night highs & lows, US only)
//   - AccuWeather (optional; 5-day daily high/low — only when a key is set)
//
// We average (equal weight) the daily highF/lowF across whichever sources have
// a value for each date; every other field stays from Open-Meteo. Each external
// source is best-effort with a timeout — if it fails or isn't configured, it's
// simply dropped, and if everything else fails the base Open-Meteo forecast is
// returned unchanged. The live forecast can therefore never break because of
// this layer.
//
// Settlement is unaffected — markets still grade on NWS observations.

import type { ForecastResponse } from './types';
import { fetchNWSForecast, fetchNWSHourlyForecast } from './nws-forecast';
import { fetchAccuWeatherDaily, accuWeatherConfigured } from './accuweather-client';
import { fetchOpenWeatherDaily, openWeatherConfigured } from './openweather';
import { getWeatherIcon } from './weather-utils';
import { fetchMetnoForecast } from './metno-client';

const SOURCE_TIMEOUT_MS = 4000;

/** Kill switch: consensus is ON unless CONSENSUS_FORECAST_ENABLED === 'false'. */
export function consensusEnabled(): boolean {
  const v =
    (import.meta as any).env?.CONSENSUS_FORECAST_ENABLED ??
    (typeof process !== 'undefined' ? process.env?.CONSENSUS_FORECAST_ENABLED : undefined);
  return String(v ?? 'true').toLowerCase() !== 'false';
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

interface DayHL {
  date: string;
  highF?: number;
  lowF?: number;
  precipPct?: number;
  condition?: string;
}

/** NWS raw periods carry probabilityOfPrecipitation.value (0-100 | null). */
function nwsPop(p: unknown): number | undefined {
  const v = (p as any)?.probabilityOfPrecipitation?.value;
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
}

/**
 * Map NWS day/night periods → per-date {highF, lowF, precipPct, condition}.
 * Daytime period = the date's high + headline condition; precip% = day-max.
 */
async function nwsDaily(lat: number, lon: number): Promise<DayHL[]> {
  const periods = await fetchNWSForecast(lat, lon);
  const byDate = new Map<string, DayHL>();
  for (const p of periods) {
    if (!p?.startTime) continue;
    const date = String(p.startTime).slice(0, 10); // local calendar date (ISO carries offset)
    if (!date) continue;
    const entry = byDate.get(date) ?? { date };
    if (typeof p.temperature === 'number' && Number.isFinite(p.temperature)) {
      // NWS US offices report °F. Daytime period = that date's high; night = low.
      if (p.isDaytime) entry.highF = Math.round(p.temperature);
      else entry.lowF = Math.round(p.temperature);
    }
    const pop = nwsPop(p);
    if (pop !== undefined) entry.precipPct = Math.max(entry.precipPct ?? 0, pop);
    if (p.isDaytime && typeof p.shortForecast === 'string' && p.shortForecast.trim()) {
      entry.condition = p.shortForecast.trim();
    }
    byDate.set(date, entry);
  }
  return Array.from(byDate.values());
}

interface NwsHour {
  tempF?: number;
  precipPct?: number;
  condition?: string;
  isDaytime: boolean;
}

/**
 * Map NWS hourly periods → { "YYYY-MM-DDTHH" (location-local) → hour }. Both
 * Open-Meteo and NWS report location-local times, so a 13-char prefix matches
 * without any timezone-offset math.
 */
async function nwsHourly(lat: number, lon: number): Promise<Map<string, NwsHour>> {
  const periods = await fetchNWSHourlyForecast(lat, lon);
  const map = new Map<string, NwsHour>();
  for (const p of periods) {
    if (!p?.startTime) continue;
    const key = String(p.startTime).slice(0, 13); // YYYY-MM-DDTHH, local
    const h: NwsHour = { isDaytime: !!p.isDaytime };
    if (typeof p.temperature === 'number' && Number.isFinite(p.temperature)) h.tempF = Math.round(p.temperature);
    const pop = nwsPop(p);
    if (pop !== undefined) h.precipPct = pop;
    if (typeof p.shortForecast === 'string' && p.shortForecast.trim()) h.condition = p.shortForecast.trim();
    map.set(key, h);
  }
  return map;
}

function mean(xs: number[]): number {
  return Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
}

// The official Wager on Weather forecast is a STRAIGHT AVERAGE of every
// prediction we have for that day or hour (Derek, 2026-11-11: "the official
// Wager on Weather Forecast which is an average of all predictions").
// Until then it was NWS-weighted (NWS 0.50, Open-Meteo 0.25, MET Norway 0.15,
// OpenWeather 0.08, AccuWeather 0.02); that blend tracked a 2.57°F MAE vs NWS
// alone at 2.77 (manual, 2026-09-11). Watch /admin/forecast-performance after
// this change. Each source that returned a value gets one equal vote.
/** Equal-weight average of every source that returned a value. Pure, exported for tests. */
export function averageOfPredictions(values: Array<{ source: string; value: number }>): number {
  return mean(values.map((v) => v.value));
}

/**
 * Take a base (Open-Meteo) forecast and blend in NWS + AccuWeather daily
 * highs/lows. Returns the base unchanged if consensus is disabled or nothing
 * extra is available. Never throws.
 */
export async function applyConsensus(
  base: ForecastResponse,
  lat: number,
  lon: number,
): Promise<ForecastResponse> {
  if (!consensusEnabled()) return base;
  if (!base?.daily?.length) return base;

  // The provider that built the base (2026-11-11). When Open-Meteo refused and
  // NWS (or OpenWeather) stood in, that provider IS the base, so it must not
  // be fetched again and counted a second time.
  const baseName = base.baseProvider === 'nws' ? 'NWS' : base.baseProvider === 'openweather' ? 'OpenWeather' : 'Open-Meteo';
  const baseIsNws = baseName === 'NWS';
  const baseIsOpenWeather = baseName === 'OpenWeather';

  try {
    const [nws, nwsHours, accu, metno, openweather] = await Promise.all([
      baseIsNws ? Promise.resolve([] as DayHL[]) : withTimeout(nwsDaily(lat, lon), SOURCE_TIMEOUT_MS, [] as DayHL[]),
      baseIsNws ? Promise.resolve(new Map<string, NwsHour>()) : withTimeout(nwsHourly(lat, lon), SOURCE_TIMEOUT_MS, new Map<string, NwsHour>()),
      withTimeout(
        accuWeatherConfigured() ? fetchAccuWeatherDaily(lat, lon) : Promise.resolve([]),
        SOURCE_TIMEOUT_MS,
        [],
      ),
      // MET Norway: free, keyless, and a different model lineage from the base,
      // so it disagrees usefully instead of echoing it. Needs the location's UTC
      // offset because MET returns UTC and everything here keys on local time.
      withTimeout(
        fetchMetnoForecast(lat, lon, base.utcOffsetSeconds ?? 0),
        SOURCE_TIMEOUT_MS,
        { daily: [], hourly: new Map<string, number>() },
      ),
      // OpenWeather: Phase 2 fallback + consensus contributor. Optional if no
      // OPENWEATHER_API_KEY is set; when available, contributes daily highs/lows
      // to improve consensus accuracy and acts as a real fallback to Open-Meteo.
      withTimeout(
        openWeatherConfigured() && !baseIsOpenWeather ? fetchOpenWeatherDaily(lat, lon) : Promise.resolve([]),
        SOURCE_TIMEOUT_MS,
        [],
      ),
    ]);

    const nwsMap = new Map(nws.map((d) => [d.date, d]));
    const accuMap = new Map(accu.map((d) => [d.date, d]));
    const metnoMap = new Map(metno.daily.map((d) => [d.date, d]));
    const openweatherMap = new Map(openweather.map((d) => [d.date, d]));
    const contributors = new Set<string>([baseName]);

    // ── Daily: average of all predictions for hi/lo and precip%; NWS condition text ──
    const daily = base.daily.map((day) => {
      const next = { ...day };
      const highs = [{ source: baseName, value: day.highF }];
      const lows = [{ source: baseName, value: day.lowF }];

      const n = nwsMap.get(day.date);
      if (n) {
        if (typeof n.highF === 'number' && Number.isFinite(n.highF)) highs.push({ source: 'NWS', value: n.highF });
        if (typeof n.lowF === 'number' && Number.isFinite(n.lowF)) lows.push({ source: 'NWS', value: n.lowF });
        if (typeof n.precipPct === 'number') { next.precipProbability = Number.isFinite(day.precipProbability) ? mean([day.precipProbability, n.precipPct]) : n.precipPct; contributors.add('NWS'); }
        if (n.condition) { next.description = n.condition; next.icon = getWeatherIcon(n.condition, false); contributors.add('NWS'); }
        if (typeof n.highF === 'number' || typeof n.lowF === 'number') contributors.add('NWS');
      }
      const a = accuMap.get(day.date);
      if (a) {
        // Only fold in finite numbers; an undefined/NaN would corrupt the blend.
        let accuContributed = false;
        if (typeof a.highF === 'number' && Number.isFinite(a.highF)) { highs.push({ source: 'AccuWeather', value: a.highF }); accuContributed = true; }
        if (typeof a.lowF === 'number' && Number.isFinite(a.lowF)) { lows.push({ source: 'AccuWeather', value: a.lowF }); accuContributed = true; }
        if (accuContributed) contributors.add('AccuWeather');
      }

      const m = metnoMap.get(day.date);
      if (m) {
        let metContributed = false;
        if (typeof m.highF === 'number' && Number.isFinite(m.highF)) { highs.push({ source: 'MET Norway', value: m.highF }); metContributed = true; }
        if (typeof m.lowF === 'number' && Number.isFinite(m.lowF)) { lows.push({ source: 'MET Norway', value: m.lowF }); metContributed = true; }
        if (metContributed) contributors.add('MET Norway');
      }

      const o = openweatherMap.get(day.date);
      if (o) {
        let owContributed = false;
        if (typeof o.highF === 'number' && Number.isFinite(o.highF)) { highs.push({ source: 'OpenWeather', value: o.highF }); owContributed = true; }
        if (typeof o.lowF === 'number' && Number.isFinite(o.lowF)) { lows.push({ source: 'OpenWeather', value: o.lowF }); owContributed = true; }
        if (owContributed) contributors.add('OpenWeather');
      }

      if (highs.length > 1) next.highF = averageOfPredictions(highs);
      if (lows.length > 1) next.lowF = averageOfPredictions(lows);
      return next;
    });

    // ── Hourly: average of all predictions for temp and precip%; NWS condition text (first ~6.5 days) ──
    const hourly = (base.hourly ?? []).map((pt) => {
      const hourKey = String(pt.time).slice(0, 13); // local YYYY-MM-DDTHH
      const nh = nwsHours.get(hourKey);
      const metTemp = metno.hourly.get(hourKey);
      // MET can cover an hour NWS does not (NWS hourly runs ~6.5 days), so an
      // hour with only MET still gets a second opinion rather than being skipped.
      if (!nh && typeof metTemp !== 'number') return pt;
      const next = { ...pt };
      if ((typeof nh?.tempF === 'number' || typeof metTemp === 'number') && Number.isFinite(pt.tempF)) {
        const parts: Array<{ source: string; value: number }> = [{ source: baseName, value: pt.tempF }];
        if (typeof nh?.tempF === 'number' && Number.isFinite(nh.tempF)) parts.push({ source: 'NWS', value: nh.tempF });
        if (typeof metTemp === 'number' && Number.isFinite(metTemp)) { parts.push({ source: 'MET Norway', value: metTemp }); contributors.add('MET Norway'); }
        const blended = averageOfPredictions(parts);
        next.tempF = blended;
        next.tempC = Math.round(((blended - 32) * 5) / 9);
        next.tempK = Math.round(((blended - 32) * 5) / 9 + 273.15);
        if (typeof nh?.tempF === 'number' && Number.isFinite(nh.tempF)) contributors.add('NWS');
      }
      // Precip% averages the base and NWS only: MET's `compact` product does not
      // carry a probability of precipitation, and inventing one from its
      // precipitation_amount would be a different quantity wearing the same name.
      if (typeof nh?.precipPct === 'number') { next.precipProbability = Number.isFinite(pt.precipProbability) ? mean([pt.precipProbability, nh.precipPct]) : nh.precipPct; contributors.add('NWS'); }
      if (nh?.condition) { next.description = nh.condition; next.icon = getWeatherIcon(nh.condition, !nh.isDaytime); contributors.add('NWS'); }
      return next;
    });

    // No external source contributed anywhere → keep the base as-is.
    if (contributors.size === 1) return base;

    const list = Array.from(contributors);
    const accuNote = accuWeatherConfigured()
      ? ''
      : ' (AccuWeather not yet configured — set ACCUWEATHER_API_KEY to include it.)';

    return {
      ...base,
      daily,
      hourly,
      source: {
        provider: base.source?.provider ?? 'open-meteo',
        label: 'Wager on Weather',
        isResearchSample: false,
        notes: `Average of all predictions (equal weight) for daily highs/lows, hourly temps and chance of precipitation, with NWS condition text, across ${list.join(' + ')}.${baseName === 'Open-Meteo' ? '' : ` Open-Meteo was unavailable, so ${baseName} supplied the base forecast.`}${accuNote}`,
      },
    };
  } catch {
    return base; // bulletproof — never break the live forecast
  }
}
