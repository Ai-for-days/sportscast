// ── Actual (observed) daily precipitation — last few days ──────────────────
//
// Everything in the forecast pipeline (Open-Meteo, the consensus blend,
// forecast-observed-floor.ts's temperature floor) is a FORECAST or a
// same-day observed correction. This file answers a different question:
// "how much rain ACTUALLY fell, officially, on a day that's already over?"
// — for the ZIP page's precipitation chart, which shows the last 3 full
// days as fact (not prediction) to the left of today.
//
// Source: the same NWS station-observation pipeline nws-grading.ts uses to
// grade weather wagers (fetchNWSObservations), but that function isn't
// reused directly here — it computes the local-day window naively via the
// SERVER's own timezone (`new Date(\`${date}T00:00:00\`)`), which only
// happens to be correct because Vercel functions run in UTC. This file
// instead reuses forecast-observed-floor.ts's more explicit UTC-offset math
// (and its cached station resolver — same station, just a different
// observed metric) so the day boundary is correct regardless of where the
// code runs.
//
// NOT the same thing as historical-averages.ts, which is 20-year
// climatology (an average), not what actually happened on one real day.
//
// Bulletproof by construction: every failure path (non-US location, no
// station, network error, NWS's ~7-day retention window on old dates)
// returns fewer days rather than throwing — a ZIP page must never break
// because a historical-data fetch failed.

import { getRedis } from './redis';
import { resolveStation } from './forecast-observed-floor';

const NWS_HEADERS = {
  'User-Agent': 'WagerOnWeather/1.0 (contact@wageronweather.com)',
  Accept: 'application/geo+json',
};
const TIMEOUT_MS = 4000;
// A past day's total is an immutable historical fact once fetched — cache
// far longer than a live/in-progress observation would warrant.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface ObservedDailyPrecip {
  /** YYYY-MM-DD, local to the venue/ZIP. */
  date: string;
  precipIn: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  } catch {
    return fallback;
  }
}

async function fetchObservedDailyPrecip(
  stationId: string,
  localDate: string,
  utcOffsetSeconds: number,
): Promise<number | null> {
  const redis = getRedis();
  const cacheKey = `nws-precip-day:${stationId}:${localDate}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached != null) return typeof cached === 'string' ? JSON.parse(cached) : (cached as number);
  } catch {
    /* redis unconfigured or miss — fall through to a live fetch */
  }

  try {
    // Local midnight expressed in UTC, same approach as
    // forecast-observed-floor.ts's fetchObservedExtremes — parse the date as
    // UTC and subtract the location's real offset, rather than letting the
    // server's own timezone leak in.
    const startMs = Date.parse(`${localDate}T00:00:00Z`) - utcOffsetSeconds * 1000;
    if (!isFinite(startMs)) return null;
    const endMs = startMs + 24 * 60 * 60 * 1000 - 1000;

    const url = `https://api.weather.gov/stations/${stationId}/observations`
      + `?start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
    const res = await fetch(url, { headers: NWS_HEADERS });
    if (!res.ok) return null;

    const features = (await res.json())?.features ?? [];
    if (features.length === 0) return null; // no observations logged at all that day

    // Not every station has a working precip gauge — plenty of AWOS/ASOS
    // sites report `precipitationLastHour: { value: null }` on EVERY
    // observation, every day (confirmed live against KCUB, Columbia SC's
    // nearest station: 300+ obs across a full day, every single precip
    // field null). The property key existing tells you nothing; only a
    // real NUMBER (0 is a legitimate reading — dry hours report 0, not
    // null) proves the sensor actually measured something. A day where
    // NO hour ever produced a number gets treated as "no data" (the bar is
    // omitted), not "0.00 inches" — reporting a confident zero from a
    // sensor that never once measured anything would be a false-precision
    // claim on a wagering-adjacent site.
    let totalMm = 0;
    let hasNumericReading = false;
    for (const f of features) {
      const v = f?.properties?.precipitationLastHour?.value;
      if (typeof v === 'number') {
        hasNumericReading = true;
        if (v > 0) totalMm += v;
      }
    }
    if (!hasNumericReading) return null;

    const precipIn = Math.round((totalMm / 25.4) * 100) / 100;
    try {
      await redis.set(cacheKey, JSON.stringify(precipIn), { ex: CACHE_TTL_SECONDS });
    } catch {
      /* ignore — worst case we refetch next time */
    }
    return precipIn;
  } catch {
    return null;
  }
}

/**
 * Actual observed precipitation (inches) for the `days` full calendar days
 * immediately before `todayLocalDate`, oldest first. A day is omitted (not
 * zero-filled) when no station or no usable observations are available for
 * it — e.g. a brand-new station, or a date past NWS's ~7-day retention
 * window on `/stations/{id}/observations`.
 */
export async function getRecentObservedPrecip(
  lat: number,
  lon: number,
  utcOffsetSeconds: number,
  days: number,
  todayLocalDate: string,
): Promise<ObservedDailyPrecip[]> {
  try {
    const stationId = await withTimeout(resolveStation(lat, lon), TIMEOUT_MS, null);
    if (!stationId) return [];

    const todayMs = Date.parse(`${todayLocalDate}T00:00:00Z`);
    if (!isFinite(todayMs)) return [];

    const dates: string[] = [];
    for (let i = days; i >= 1; i--) {
      dates.push(new Date(todayMs - i * 86400000).toISOString().slice(0, 10));
    }

    const results = await Promise.all(
      dates.map(async (date) => {
        const precipIn = await withTimeout(
          fetchObservedDailyPrecip(stationId, date, utcOffsetSeconds),
          TIMEOUT_MS,
          null,
        );
        return precipIn == null ? null : { date, precipIn };
      }),
    );
    return results.filter((r): r is ObservedDailyPrecip => r !== null);
  } catch {
    return [];
  }
}
