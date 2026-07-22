// MLB schedule → venue mapping for the daily MLB Weather Report page.
//
// Source: the free, public MLB Stats API (statsapi.mlb.com, no key). We fetch a
// day's schedule, map each game's HOME team to our venue-data entry (for lat/lon
// + roof type), and cache the lean result in Redis for 30 minutes. Bulletproof:
// every failure path degrades to an empty list so the page still renders.

import { venues } from './venue-data';
import { getRedis } from './redis';
import type { Venue } from './types';

export interface MlbGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  gameDateUTC: string; // ISO 8601, e.g. "2026-07-22T23:05:00Z"
  status: string; // "Scheduled" | "In Progress" | "Final" | ...
  venue: Venue | null; // matched venue-data entry (coords + roof); null if unmapped
}

interface CachedGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  gameDateUTC: string;
  status: string;
}

const SCHEDULE_TTL_SECONDS = 1800; // 30 min

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

// Home-team-name -> venue (built once). MLB Stats API team names match
// venue-data `team` fields ("Boston Red Sox", "New York Yankees", ...).
const teamToVenue = new Map<string, Venue>();
for (const v of venues) {
  if (v.league === 'mlb' && v.team) teamToVenue.set(normTeam(v.team), v);
}

function attachVenue(g: CachedGame): MlbGame {
  return { ...g, venue: teamToVenue.get(normTeam(g.homeTeam)) ?? null };
}

/** Games for a given YYYY-MM-DD (US date). Cached 30 min; never throws. */
export async function getMlbGamesForDate(dateStr: string): Promise<MlbGame[]> {
  const cacheKey = `mlb:schedule:${dateStr}`;

  // 1. Cache read (both Upstash shapes per CLAUDE.md).
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw) {
      const cached = (typeof raw === 'string' ? JSON.parse(raw) : raw) as CachedGame[];
      return cached.map(attachVenue);
    }
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  // 2. Fetch from MLB Stats API (timeout-bounded).
  let cached: CachedGame[] = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}`,
      { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      for (const day of data?.dates ?? []) {
        for (const g of day?.games ?? []) {
          const homeTeam = g?.teams?.home?.team?.name ?? '';
          const awayTeam = g?.teams?.away?.team?.name ?? '';
          if (!homeTeam || !awayTeam) continue;
          cached.push({
            gamePk: g?.gamePk ?? 0,
            homeTeam,
            awayTeam,
            gameDateUTC: g?.gameDate ?? '',
            status: g?.status?.detailedState ?? g?.status?.abstractGameState ?? 'Scheduled',
          });
        }
      }
    }
  } catch {
    cached = [];
  }

  // 3. Cache write (best-effort).
  try {
    if (cached.length) await getRedis().set(cacheKey, JSON.stringify(cached), { ex: SCHEDULE_TTL_SECONDS });
  } catch {
    /* ignore */
  }

  return cached.map(attachVenue);
}
