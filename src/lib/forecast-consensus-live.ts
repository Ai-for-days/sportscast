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
import { getWeatherIcon } from './weather-utils';

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

// NWS is the US authority the site is benchmarked against, so it DOMINATES the
// blend; Open-Meteo (the base) and AccuWeather act as corrections rather than
// equal votes. Weights renormalize over whichever sources contributed a value.
const SOURCE_WEIGHTS: Record<string, number> = {
  NWS: 0.55,
  'Open-Meteo': 0.30,
  AccuWeather: 0.15,
};

function weightedBlend(values: Array<{ source: string; value: number }>): number {
  const totalW = values.reduce((s, v) => s + (SOURCE_WEIGHTS[v.source] ?? 0), 0);
  if (totalW <= 0) return mean(values.map((v) => v.value));
  return Math.round(values.reduce((s, v) => s + v.value * (SOURCE_WEIGHTS[v.source] ?? 0), 0) / totalW);
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

  try {
    const [nws, nwsHours, accu] = await Promise.all([
      withTimeout(nwsDaily(lat, lon), SOURCE_TIMEOUT_MS, [] as DayHL[]),
      withTimeout(nwsHourly(lat, lon), SOURCE_TIMEOUT_MS, new Map<string, NwsHour>()),
      withTimeout(
        accuWeatherConfigured() ? fetchAccuWeatherDaily(lat, lon) : Promise.resolve([]),
        SOURCE_TIMEOUT_MS,
        [],
      ),
    ]);

    const nwsMap = new Map(nws.map((d) => [d.date, d]));
    const accuMap = new Map(accu.map((d) => [d.date, d]));
    const contributors = new Set<string>(['Open-Meteo']);

    // ── Daily: NWS-weighted hi/lo; NWS-primary precip% + condition ──
    const daily = base.daily.map((day) => {
      const next = { ...day };
      const highs = [{ source: 'Open-Meteo', value: day.highF }];
      const lows = [{ source: 'Open-Meteo', value: day.lowF }];

      const n = nwsMap.get(day.date);
      if (n) {
        if (typeof n.highF === 'number' && Number.isFinite(n.highF)) highs.push({ source: 'NWS', value: n.highF });
        if (typeof n.lowF === 'number' && Number.isFinite(n.lowF)) lows.push({ source: 'NWS', value: n.lowF });
        if (typeof n.precipPct === 'number') { next.precipProbability = n.precipPct; contributors.add('NWS'); }
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

      if (highs.length > 1) next.highF = weightedBlend(highs); // NWS-weighted
      if (lows.length > 1) next.lowF = weightedBlend(lows);
      return next;
    });

    // ── Hourly: NWS-weighted temp; NWS-primary precip% + condition (first ~6.5 days) ──
    const hourly = (base.hourly ?? []).map((pt) => {
      const nh = nwsHours.get(String(pt.time).slice(0, 13)); // match by local YYYY-MM-DDTHH
      if (!nh) return pt;
      const next = { ...pt };
      if (typeof nh.tempF === 'number' && Number.isFinite(pt.tempF)) {
        const blended = weightedBlend([
          { source: 'Open-Meteo', value: pt.tempF },
          { source: 'NWS', value: nh.tempF },
        ]);
        next.tempF = blended;
        next.tempC = Math.round(((blended - 32) * 5) / 9);
        next.tempK = Math.round(((blended - 32) * 5) / 9 + 273.15);
        contributors.add('NWS');
      }
      if (typeof nh.precipPct === 'number') { next.precipProbability = nh.precipPct; contributors.add('NWS'); }
      if (nh.condition) { next.description = nh.condition; next.icon = getWeatherIcon(nh.condition, !nh.isDaytime); contributors.add('NWS'); }
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
        label: 'WagerOnWeather Consensus',
        isResearchSample: false,
        notes: `NWS-weighted daily highs/lows + hourly temps, with NWS conditions & precip, across ${list.join(' + ')}.${accuNote}`,
      },
    };
  } catch {
    return base; // bulletproof — never break the live forecast
  }
}
