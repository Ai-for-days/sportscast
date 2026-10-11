// Open-Meteo usage meter (2026-10-11).
//
// Open-Meteo was 429ing us all day (165 of 169 Open-Meteo alerts in the 7 days
// to 10-11 were 429 "too many requests", 4 were 503s). Before choosing between
// cutting usage and buying a plan we need the real numbers, which nothing
// recorded. Every Open-Meteo request now goes through `meteredOpenMeteoFetch`,
// which counts BILLED calls per caller per hour, plus how many came back 429.
//
// Billed, not requests, because Open-Meteo weights them: one location with more
// than 10 variables or more than 14 days counts as more than one call, and a
// multi-location request counts once per location. Our main forecast asks for
// ~39 variables over 16 days, about 4.5 calls; one map-grid request can be 400.
//
// Free-tier limits for reference: 600/min, 5,000/hour, 10,000/day, 300,000/month,
// and no commercial use. The free tier also counts per IP, and Vercel functions
// share egress IPs with other Vercel customers.
//
// Cost: two Redis writes per request, fire-and-forget, never throws.

import { getRedis } from './redis';

export type OpenMeteoCaller = 'forecast' | 'air-quality' | 'map-grid' | 'forecast-grid' | 'historical';

const KEY_PREFIX = 'om-usage:';
const KEEP_SECONDS = 8 * 86400;

function listLength(v: string | null): number {
  return v ? v.split(',').filter(Boolean).length : 0;
}

/**
 * Billed calls for one request URL, by Open-Meteo's published rule: per
 * location, max(1, variables / 10) x max(1, days / 14). Pure, for tests.
 */
export function billedCalls(url: string): number {
  let u: URL;
  try { u = new URL(url); } catch { return 1; }
  const q = u.searchParams;
  const locations = Math.max(1, listLength(q.get('latitude')));
  const variables = listLength(q.get('hourly')) + listLength(q.get('daily')) + listLength(q.get('current'))
    + listLength(q.get('minutely_15'));
  let days = Number(q.get('forecast_days') ?? 0) + Number(q.get('past_days') ?? 0);
  const start = q.get('start_date'), end = q.get('end_date');
  if (start && end) days = Math.max(days, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
  const perLocation = Math.max(1, variables / 10) * Math.max(1, (days || 1) / 14);
  return Math.round(locations * perLocation * 100) / 100;
}

/** `YYYY-MM-DDTHH` in UTC, the hourly bucket. */
export function usageHourKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

/** `lat,lon` of a single-location request, else null. Pure, for tests. */
export function requestLocation(url: string): string | null {
  try {
    const q = new URL(url).searchParams;
    const lat = q.get('latitude'), lon = q.get('longitude');
    return lat && lon && !lat.includes(',') ? `${lat},${lon}` : null;
  } catch {
    return null;
  }
}

async function record(caller: OpenMeteoCaller, calls: number, status: number, location: string | null = null): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${KEY_PREFIX}${usageHourKey(Date.now())}`;
    const p = redis.pipeline();
    p.hincrbyfloat(key, `${caller}:calls`, calls);
    p.hincrby(key, `${caller}:requests`, 1);
    if (status === 429) p.hincrby(key, `${caller}:429`, 1);
    p.expire(key, KEEP_SECONDS);
    // Which locations, so venues (background jobs) can be told apart from ZIP
    // centroids (visitors and crawlers). Single-location requests only.
    if (location && caller === 'forecast') {
      const locKey = `${KEY_PREFIX}loc:${usageHourKey(Date.now())}`;
      p.hincrby(locKey, location, 1);
      p.expire(locKey, 2 * 86400);
    }
    await p.exec();
  } catch {
    /* metering must never break a forecast */
  }
}

/** fetch() for any Open-Meteo URL, metered by caller. Same contract as fetch. */
export async function meteredOpenMeteoFetch(url: string, init: RequestInit | undefined, caller: OpenMeteoCaller): Promise<Response> {
  const res = await fetch(url, init);
  void record(caller, billedCalls(url), res.status, requestLocation(url));
  return res;
}

export interface UsageHour {
  hour: string;
  byCaller: Record<string, { calls: number; requests: number; rateLimited: number }>;
  calls: number;
  rateLimited: number;
}

/** The last `hours` hourly buckets, newest first. */
export async function getOpenMeteoUsage(hours = 48): Promise<UsageHour[]> {
  const now = Date.now();
  const keys = Array.from({ length: hours }, (_, i) => usageHourKey(now - i * 3600_000));
  try {
    const p = getRedis().pipeline();
    for (const k of keys) p.hgetall(`${KEY_PREFIX}${k}`);
    const rows = (await p.exec()) as (Record<string, unknown> | null)[];
    return keys.map((hour, i) => {
      const byCaller: UsageHour['byCaller'] = {};
      for (const [field, value] of Object.entries(rows[i] ?? {})) {
        const [caller, metric] = field.split(':');
        const c = (byCaller[caller] ??= { calls: 0, requests: 0, rateLimited: 0 });
        const n = Number(value) || 0;
        if (metric === 'calls') c.calls += n;
        else if (metric === 'requests') c.requests += n;
        else if (metric === '429') c.rateLimited += n;
      }
      const all = Object.values(byCaller);
      return {
        hour,
        byCaller,
        calls: Math.round(all.reduce((s, c) => s + c.calls, 0)),
        rateLimited: all.reduce((s, c) => s + c.rateLimited, 0),
      };
    });
  } catch {
    return [];
  }
}
