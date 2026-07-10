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
import { fetchNWSForecast } from './nws-forecast';
import { fetchAccuWeatherDaily, accuWeatherConfigured } from './accuweather-client';

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
}

/** Map NWS day/night periods → {date: {highF, lowF}} (daytime=high, night=low). */
async function nwsDailyHighLow(lat: number, lon: number): Promise<DayHL[]> {
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
    byDate.set(date, entry);
  }
  return Array.from(byDate.values());
}

function mean(xs: number[]): number {
  return Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
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
    const [nws, accu] = await Promise.all([
      withTimeout(nwsDailyHighLow(lat, lon), SOURCE_TIMEOUT_MS, [] as DayHL[]),
      withTimeout(
        accuWeatherConfigured() ? fetchAccuWeatherDaily(lat, lon) : Promise.resolve([]),
        SOURCE_TIMEOUT_MS,
        [],
      ),
    ]);

    const nwsMap = new Map(nws.map((d) => [d.date, d]));
    const accuMap = new Map(accu.map((d) => [d.date, d]));
    const contributors = new Set<string>(['Open-Meteo']);

    const daily = base.daily.map((day) => {
      const highs = [day.highF];
      const lows = [day.lowF];

      const n = nwsMap.get(day.date);
      if (n) {
        if (typeof n.highF === 'number') highs.push(n.highF);
        if (typeof n.lowF === 'number') lows.push(n.lowF);
        if (typeof n.highF === 'number' || typeof n.lowF === 'number') contributors.add('NWS');
      }
      const a = accuMap.get(day.date);
      if (a) {
        // Guard like the NWS branch above: only fold in finite numbers.
        // An undefined/NaN high or low here would poison mean() and
        // corrupt the blended value for this date on every pull.
        let accuContributed = false;
        if (typeof a.highF === 'number' && Number.isFinite(a.highF)) {
          highs.push(a.highF);
          accuContributed = true;
        }
        if (typeof a.lowF === 'number' && Number.isFinite(a.lowF)) {
          lows.push(a.lowF);
          accuContributed = true;
        }
        if (accuContributed) contributors.add('AccuWeather');
      }

      if (highs.length === 1 && lows.length === 1) return day; // Open-Meteo only for this date
      return { ...day, highF: mean(highs), lowF: mean(lows) };
    });

    // No external source contributed to any date → keep the base as-is.
    if (contributors.size === 1) return base;

    const list = Array.from(contributors);
    const accuNote = accuWeatherConfigured()
      ? ''
      : ' (AccuWeather not yet configured — set ACCUWEATHER_API_KEY to include it.)';

    return {
      ...base,
      daily,
      source: {
        provider: base.source?.provider ?? 'open-meteo',
        label: 'WagerOnWeather Consensus',
        isResearchSample: false,
        notes: `Daily highs/lows averaged across ${list.join(' + ')}.${accuNote}`,
      },
    };
  } catch {
    return base; // bulletproof — never break the live forecast
  }
}
