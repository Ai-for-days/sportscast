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
const RANGE_TTL_SECONDS = 3600; // 1 hour, shared across every MLB team
const RANGE_FAILURE_BACKOFF_SECONDS = 180; // 3 min — throttles retries on outage

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

// ── Next home game (used by venue pages) ────────────────────────────────
//
// venue-schedule.ts uses ESPN for this across every other league, but ESPN
// rate-limits our Vercel egress IP — confirmed live 2026-08-19 (403 on every
// request, while the exact same call succeeds from elsewhere). The MLB Stats
// API is a different provider and is NOT affected, and this page already
// depends on it for /mlb-weather, so MLB's "next home game" lookup routes
// through it instead of ESPN.

export interface MlbNextHomeGame {
  opponent: string;
  kickoffUTC: string; // ISO 8601
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
}

function abstractStateToGameState(abstractGameState: unknown): 'pre' | 'in' | 'post' {
  return abstractGameState === 'Live' ? 'in' : abstractGameState === 'Final' ? 'post' : 'pre';
}

async function fetchRangeGames(startDateStr: string, endDateStr: string): Promise<CachedGame[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDateStr}&endDate=${endDateStr}`,
      { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data: any = await res.json();
    const games: CachedGame[] = [];
    for (const day of data?.dates ?? []) {
      for (const g of day?.games ?? []) {
        const homeTeam = g?.teams?.home?.team?.name ?? '';
        const awayTeam = g?.teams?.away?.team?.name ?? '';
        if (!homeTeam || !awayTeam) continue;
        games.push({
          gamePk: g?.gamePk ?? 0,
          homeTeam,
          awayTeam,
          gameDateUTC: g?.gameDate ?? '',
          status: g?.status?.abstractGameState ?? 'Preview',
        });
      }
    }
    return games;
  } catch {
    return null;
  }
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** One fetch (cached) serves every MLB team — same sharing model as the ESPN league cache. */
async function getMlbRangeGames(): Promise<CachedGame[] | null> {
  const cacheKey = 'mlb:schedule:range';
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw !== null && raw !== undefined) return (typeof raw === 'string' ? JSON.parse(raw) : raw) as CachedGame[];
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  const now = new Date();
  let games: CachedGame[] | null = null;
  let anySuccess = false;
  // 30 days covers the near-daily regular season; 210 bridges the Oct-Mar off-season.
  for (const days of [30, 210]) {
    const end = new Date(now.getTime() + days * 86400000);
    const fetched = await fetchRangeGames(yyyymmdd(now), yyyymmdd(end));
    if (fetched !== null) {
      anySuccess = true;
      games = fetched;
      if (fetched.length > 0) break;
    }
  }

  try {
    const ttl = anySuccess ? RANGE_TTL_SECONDS : RANGE_FAILURE_BACKOFF_SECONDS;
    await getRedis().set(cacheKey, JSON.stringify(games ?? []), { ex: ttl });
  } catch {
    /* ignore */
  }

  return games;
}

/** The soonest upcoming home game for a venue's MLB team, matched by team name. Never throws. */
export async function getNextMlbHomeGame(teamName: string): Promise<MlbNextHomeGame | null> {
  const games = await getMlbRangeGames();
  if (!games) return null;

  const wanted = normTeam(teamName);
  const nowMs = Date.now();
  let best: { ms: number; game: MlbNextHomeGame } | null = null;
  for (const g of games) {
    if (normTeam(g.homeTeam) !== wanted) continue;
    const ms = Date.parse(g.gameDateUTC);
    if (!Number.isFinite(ms) || ms < nowMs) continue;
    if (best && ms >= best.ms) continue;
    best = {
      ms,
      game: {
        opponent: g.awayTeam,
        kickoffUTC: g.gameDateUTC,
        state: abstractStateToGameState(g.status),
        statusDetail: g.status,
      },
    };
  }
  return best?.game ?? null;
}
