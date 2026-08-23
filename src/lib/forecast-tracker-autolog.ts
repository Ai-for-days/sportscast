// ── Forecast Tracker autolog ────────────────────────────────────────────────
//
// Records Forecast Tracker entries automatically, so the accuracy leaderboard
// fills itself instead of depending on an operator remembering to run pulls.
//
// The tracker's auto-pull endpoint only PRE-FILLS a form — a human still has to
// click Submit for anything to be stored. That made the leaderboard a
// discipline problem rather than a data problem: no pulls, no data, no way to
// tell whether a forecast change helped.
//
// This logs the three sources we can fetch without a key or a human:
//   - wageronweather-consensus : what the live site publishes
//   - wageronweather           : the raw Open-Meteo model (diagnostic)
//   - nws                      : the National Weather Service
// AccuWeather joins automatically once ACCUWEATHER_API_KEY is set, because the
// consensus picks it up upstream. Weather.com has no affordable API and stays
// a manual column.
//
// Deliberately never logs a target date of TODAY: getForecast() floors today's
// high/low with observations already recorded (forecast-observed-floor.ts), so
// scoring that as a forecast would flatter the consensus.
//
// Boundaries: writes ONLY to the forecast-tracker store. No grading,
// settlement, wallet, pricing, or customer surface is touched. Every failure is
// captured per city so one bad city cannot sink the run.

import { FORECAST_QUALITY_SEED_CITIES } from './forecast-quality-seed-cities';
import { getOpenMeteoForecast } from './open-meteo';
import { getForecast } from './weather-queries';
import { fetchNWSForecast } from './nws-forecast';
import {
  createForecastEntry,
  listForecastEntries,
  resolveNWSStation,
} from './forecast-tracker-store';
import type { ForecastEntry, ForecastMetric } from './forecast-tracker-types';
import type { ForecastResponse } from './types';

/** Metrics logged. Both are daily, so neither needs a target time. */
const METRICS: ForecastMetric[] = ['high_temp', 'low_temp'];

/** Days ahead to log. Never 0 — see the observation-floor note above. */
export const DEFAULT_HORIZONS = [1, 3] as const;

const DEFAULT_CONCURRENCY = 4;
/** Wall-clock budget. Vercel functions cap at 60s; stop early and report. */
const DEFAULT_BUDGET_MS = 45_000;
/** How many recent entries to scan for duplicates. */
const DEDUPE_SCAN_LIMIT = 1000;

export type AutologSource = 'wageronweather-consensus' | 'wageronweather' | 'nws';

export interface AutologOptions {
  seedCityIds?: string[];
  horizons?: number[];
  concurrency?: number;
  budgetMs?: number;
  /** Skip the write and just report what would be written. */
  dryRun?: boolean;
}

export interface AutologResult {
  written: number;
  skippedDuplicate: number;
  skippedNoValue: number;
  citiesProcessed: number;
  citiesSkippedForBudget: number;
  warnings: string[];
  dryRun: boolean;
  samples: { locationName: string; metric: string; targetDate: string; source: string; value: number }[];
}

/**
 * Identity of a logged forecast. One row per (city, metric, date, source) —
 * re-running the cron the same day must not double-count a source.
 */
export function dedupeKey(
  locationName: string,
  metric: string,
  targetDate: string,
  source: string,
): string {
  return `${locationName}|${metric}|${targetDate}|${source}`;
}

export function entryDedupeKey(e: ForecastEntry): string {
  const source = e.source && e.source.length > 0 ? e.source[0] : 'wageronweather';
  return dedupeKey(e.locationName, e.metric, e.targetDate, source);
}

/**
 * Target date `daysAhead` from the forecast's own local today. Uses the
 * forecast's daily[0].date rather than the server clock, so the date is always
 * local to the city — the server runs in UTC and would roll over early.
 */
export function targetDateFrom(localToday: string, daysAhead: number): string {
  const ms = Date.parse(`${localToday}T12:00:00Z`) + daysAhead * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function pickDaily(forecast: ForecastResponse, targetDate: string, metric: ForecastMetric): number | null {
  const day = forecast.daily?.find((d) => d.date === targetDate);
  if (!day) return null;
  const v = metric === 'high_temp' ? day.highF : day.lowF;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** NWS day/night periods -> {date: {high, low}}. */
function nwsDailyMap(periods: any[]): Map<string, { high?: number; low?: number }> {
  const map = new Map<string, { high?: number; low?: number }>();
  for (const p of periods ?? []) {
    const date = typeof p?.startTime === 'string' ? p.startTime.slice(0, 10) : null;
    const temp = typeof p?.temperature === 'number' ? p.temperature : null;
    if (!date || temp === null) continue;
    const cur = map.get(date) ?? {};
    if (p.isDaytime) cur.high = temp;
    else cur.low = temp;
    map.set(date, cur);
  }
  return map;
}

export async function runForecastTrackerAutolog(
  options: AutologOptions = {},
): Promise<AutologResult> {
  const started = Date.now();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const horizons = (options.horizons ?? [...DEFAULT_HORIZONS]).filter((h) => h >= 1);
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? DEFAULT_CONCURRENCY));
  const dryRun = options.dryRun === true;

  const cities = options.seedCityIds?.length
    ? FORECAST_QUALITY_SEED_CITIES.filter((c) => options.seedCityIds!.includes(c.id))
    : FORECAST_QUALITY_SEED_CITIES;

  const result: AutologResult = {
    written: 0,
    skippedDuplicate: 0,
    skippedNoValue: 0,
    citiesProcessed: 0,
    citiesSkippedForBudget: 0,
    warnings: [],
    dryRun,
    samples: [],
  };

  if (horizons.length === 0) {
    result.warnings.push('No valid horizons (must be >= 1 day; today is never logged).');
    return result;
  }

  // Existing keys, so a re-run in the same day is a no-op rather than a
  // duplicate. Bounded scan — a day's writes are far below the limit.
  let existing = new Set<string>();
  try {
    const recent = await listForecastEntries(DEDUPE_SCAN_LIMIT);
    existing = new Set(recent.map(entryDedupeKey));
  } catch (err: any) {
    result.warnings.push(`Could not load existing entries for dedupe: ${err?.message ?? err}`);
  }

  let cursor = 0;
  async function worker() {
    while (true) {
      if (Date.now() - started > budgetMs) return;
      const idx = cursor++;
      if (idx >= cities.length) return;
      const city = cities[idx];

      try {
        const [consensus, raw, nwsPeriods, station] = await Promise.all([
          getForecast(city.lat, city.lon, 8).catch((e) => {
            result.warnings.push(`${city.label} Wager on Weather forecast: ${e?.message ?? e}`);
            return null;
          }),
          getOpenMeteoForecast(city.lat, city.lon, 8).catch((e) => {
            result.warnings.push(`${city.label} raw model: ${e?.message ?? e}`);
            return null;
          }),
          fetchNWSForecast(city.lat, city.lon).catch((e) => {
            result.warnings.push(`${city.label} NWS: ${e?.message ?? e}`);
            return [] as any[];
          }),
          resolveNWSStation(city.lat, city.lon).catch((e) => {
            result.warnings.push(`${city.label} station: ${e?.message ?? e}`);
            return null;
          }),
        ]);

        // Local today comes from whichever forecast responded.
        const localToday = consensus?.daily?.[0]?.date ?? raw?.daily?.[0]?.date;
        if (!localToday || !station) {
          result.warnings.push(`${city.label}: skipped (no forecast or no station).`);
          continue;
        }

        const nwsMap = nwsDailyMap(nwsPeriods as any[]);

        for (const daysAhead of horizons) {
          const targetDate = targetDateFrom(localToday, daysAhead);
          for (const metric of METRICS) {
            const values: [AutologSource, number | null][] = [
              ['wageronweather-consensus', consensus ? pickDaily(consensus, targetDate, metric) : null],
              ['wageronweather', raw ? pickDaily(raw, targetDate, metric) : null],
              [
                'nws',
                (() => {
                  const d = nwsMap.get(targetDate);
                  if (!d) return null;
                  const v = metric === 'high_temp' ? d.high : d.low;
                  return typeof v === 'number' ? v : null;
                })(),
              ],
            ];

            for (const [source, value] of values) {
              if (value === null) {
                result.skippedNoValue++;
                continue;
              }
              const key = dedupeKey(city.label, metric, targetDate, source);
              if (existing.has(key)) {
                result.skippedDuplicate++;
                continue;
              }
              existing.add(key); // guard within this run too

              if (result.samples.length < 12) {
                result.samples.push({ locationName: city.label, metric, targetDate, source, value });
              }
              if (dryRun) {
                result.written++;
                continue;
              }
              try {
                await createForecastEntry({
                  locationName: city.label,
                  lat: city.lat,
                  lon: city.lon,
                  metric,
                  targetDate,
                  forecastValue: value,
                  source: [source],
                  stationId: station.stationId,
                  timeZone: station.timeZone,
                });
                result.written++;
              } catch (err: any) {
                result.warnings.push(
                  `${city.label} ${metric} ${targetDate} ${source}: ${err?.message ?? err}`,
                );
              }
            }
          }
        }

        result.citiesProcessed++;
      } catch (err: any) {
        result.warnings.push(`${city.label}: ${err?.message ?? err}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const unprocessed = cities.length - result.citiesProcessed;
  if (unprocessed > 0) {
    result.citiesSkippedForBudget = unprocessed;
    result.warnings.push(
      `${unprocessed} city/cities not processed within the ${Math.round(budgetMs / 1000)}s budget — they will be picked up on the next run.`,
    );
  }

  return result;
}
