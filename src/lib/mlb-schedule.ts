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

interface ProbablePitcherRef {
  id: number;
  name: string;
}

interface CachedGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  gameDateUTC: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeProbablePitcher: ProbablePitcherRef | null;
  awayProbablePitcher: ProbablePitcherRef | null;
  inning: number | null;
  inningState: string | null; // "Top" | "Middle" | "Bottom" | "End"
}

const SCHEDULE_TTL_SECONDS = 1800; // 30 min
const RANGE_TTL_SECONDS = 3600; // 1 hour, shared across every MLB team
const RANGE_FAILURE_BACKOFF_SECONDS = 180; // 3 min — throttles retries on outage

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

/** Midnight today in America/New_York, as epoch ms. Used as the lower bound
 * for "today onward" game listings so a game already in progress or
 * finished today isn't dropped just because its scheduled start time has
 * passed — a strict `ms < Date.now()` floor was excluding every game that
 * had already begun, which is exactly the ones with a score to show. */
export function startOfTodayET(ref: Date = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(ref).map((p) => [p.type, p.value]),
  );
  const localAsUTCms = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = localAsUTCms - ref.getTime();
  const midnightLocalAsUTCms = Date.UTC(+parts.year, +parts.month - 1, +parts.day, 0, 0, 0);
  return midnightLocalAsUTCms - offsetMs;
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
            homeScore: Number.isFinite(g?.teams?.home?.score) ? g.teams.home.score : null,
            awayScore: Number.isFinite(g?.teams?.away?.score) ? g.teams.away.score : null,
            homeProbablePitcher: null,
            awayProbablePitcher: null,
            inning: null,
            inningState: null,
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
  gamePk: number;
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
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDateStr}&endDate=${endDateStr}&hydrate=probablePitcher,linescore`,
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
        const homePP = g?.teams?.home?.probablePitcher;
        const awayPP = g?.teams?.away?.probablePitcher;
        games.push({
          gamePk: g?.gamePk ?? 0,
          homeTeam,
          awayTeam,
          gameDateUTC: g?.gameDate ?? '',
          status: g?.status?.abstractGameState ?? 'Preview',
          homeScore: Number.isFinite(g?.teams?.home?.score) ? g.teams.home.score : null,
          awayScore: Number.isFinite(g?.teams?.away?.score) ? g.teams.away.score : null,
          homeProbablePitcher: homePP?.id && homePP?.fullName ? { id: homePP.id, name: homePP.fullName } : null,
          awayProbablePitcher: awayPP?.id && awayPP?.fullName ? { id: awayPP.id, name: awayPP.fullName } : null,
          inning: Number.isFinite(g?.linescore?.currentInning) ? g.linescore.currentInning : null,
          inningState: g?.linescore?.inningState ?? null,
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

/** The next `count` upcoming home games for a venue's MLB team, soonest first, matched by team name. Never throws. */
export async function getNextMlbHomeGames(teamName: string, count: number): Promise<MlbNextHomeGame[]> {
  const games = await getMlbRangeGames();
  if (!games) return [];

  const wanted = normTeam(teamName);
  const nowMs = Date.now();
  const upcoming: { ms: number; game: MlbNextHomeGame }[] = [];
  for (const g of games) {
    if (normTeam(g.homeTeam) !== wanted) continue;
    const ms = Date.parse(g.gameDateUTC);
    if (!Number.isFinite(ms) || ms < nowMs) continue;
    upcoming.push({
      ms,
      game: {
        gamePk: g.gamePk,
        opponent: g.awayTeam,
        kickoffUTC: g.gameDateUTC,
        state: abstractStateToGameState(g.status),
        statusDetail: g.status,
      },
    });
  }
  upcoming.sort((a, b) => a.ms - b.ms);
  return upcoming.slice(0, count).map((u) => u.game);
}

/** The single soonest upcoming home game for a venue's MLB team, matched by team name. Never throws. */
export async function getNextMlbHomeGame(teamName: string): Promise<MlbNextHomeGame | null> {
  const games = await getNextMlbHomeGames(teamName, 1);
  return games[0] ?? null;
}

export interface MlbScheduleGame {
  gamePk: number;
  homeTeam: string;
  awayTeam: string;
  kickoffUTC: string; // ISO 8601
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  homePitcher: ProbablePitcher | null;
  awayPitcher: ProbablePitcher | null;
  inning: number | null;
  inningState: string | null; // "Top" | "Middle" | "Bottom" | "End"
}

/** Every MLB game league-wide (not filtered by team) starting within `days` from now, soonest first. Never throws.
 * Probable-pitcher handedness comes off the range fetch's own hydrate, resolved with one
 * cached lookup per UNIQUE pitcher across the whole window (not per game). */
export async function getUpcomingMlbGames(days: number): Promise<MlbScheduleGame[]> {
  const games = await getMlbRangeGames();
  if (!games) return [];

  const nowMs = Date.now();
  const floorMs = startOfTodayET(new Date(nowMs));
  const cutoffMs = nowMs + days * 86400000;
  const upcoming: { ms: number; g: CachedGame }[] = [];
  for (const g of games) {
    const ms = Date.parse(g.gameDateUTC);
    if (!Number.isFinite(ms) || ms < floorMs || ms > cutoffMs) continue;
    upcoming.push({ ms, g });
  }
  upcoming.sort((a, b) => a.ms - b.ms);

  const pitcherIds = new Set<number>();
  for (const { g } of upcoming) {
    if (g.homeProbablePitcher) pitcherIds.add(g.homeProbablePitcher.id);
    if (g.awayProbablePitcher) pitcherIds.add(g.awayProbablePitcher.id);
  }
  const hands = new Map<number, 'R' | 'L' | null>();
  await Promise.all([...pitcherIds].map(async (id) => hands.set(id, await fetchPitcherHand(id))));

  return upcoming.map(({ g }) => ({
    gamePk: g.gamePk,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    kickoffUTC: g.gameDateUTC,
    state: abstractStateToGameState(g.status),
    statusDetail: g.status,
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    homePitcher: g.homeProbablePitcher ? { name: g.homeProbablePitcher.name, hand: hands.get(g.homeProbablePitcher.id) ?? null } : null,
    awayPitcher: g.awayProbablePitcher ? { name: g.awayProbablePitcher.name, hand: hands.get(g.awayProbablePitcher.id) ?? null } : null,
    inning: g.inning,
    inningState: g.inningState,
  }));
}

export interface MlbNextGame {
  gamePk: number;
  opponent: string;
  isHome: boolean;
  kickoffUTC: string; // ISO 8601
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
}

/** The next `count` upcoming games overall (home or away) for a team, soonest first, matched by team name. Never throws. */
export async function getNextMlbGames(teamName: string, count: number): Promise<MlbNextGame[]> {
  const games = await getMlbRangeGames();
  if (!games) return [];

  const wanted = normTeam(teamName);
  const nowMs = Date.now();
  const upcoming: { ms: number; game: MlbNextGame }[] = [];
  for (const g of games) {
    const isHome = normTeam(g.homeTeam) === wanted;
    const isAway = normTeam(g.awayTeam) === wanted;
    if (!isHome && !isAway) continue;
    const ms = Date.parse(g.gameDateUTC);
    if (!Number.isFinite(ms) || ms < nowMs) continue;
    upcoming.push({
      ms,
      game: {
        gamePk: g.gamePk,
        opponent: isHome ? g.awayTeam : g.homeTeam,
        isHome,
        kickoffUTC: g.gameDateUTC,
        state: abstractStateToGameState(g.status),
        statusDetail: g.status,
      },
    });
  }
  upcoming.sort((a, b) => a.ms - b.ms);
  return upcoming.slice(0, count).map((u) => u.game);
}

// ── Probable starting pitchers ──────────────────────────────────────────
//
// MLB Stats API's schedule endpoint carries probable pitchers via
// `hydrate=probablePitcher`, filterable straight to one game with `gamePk`.
// Handedness isn't in that hydrate — it needs a second call per pitcher to
// `/people/{id}`. Verified live 2026-08-19: reliably populated ~1 day out,
// thins fast by day 2-3, essentially absent 5+ days out — so "not
// announced yet" is the normal, expected state for most upcoming games,
// not a failure.

export interface ProbablePitcher {
  name: string;
  hand: 'R' | 'L' | null; // null if not yet known or the handedness lookup failed
}

export interface ProbablePitchers {
  home: ProbablePitcher | null;
  away: ProbablePitcher | null;
}

const PITCHERS_TTL_SECONDS = 1800; // 30 min — probables can be announced/scratched during this window
const PITCHER_HAND_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — a pitcher's throwing hand never changes

async function fetchPitcherHand(id: number): Promise<'R' | 'L' | null> {
  const cacheKey = `mlb:pitcher-hand:${id}`;
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw === 'R' || raw === 'L') return raw;
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  let hand: 'R' | 'L' | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${id}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WagerOnWeather/1.0' },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      const code = data?.people?.[0]?.pitchHand?.code;
      hand = code === 'R' || code === 'L' ? code : null;
    }
  } catch {
    hand = null;
  }

  if (hand) {
    try {
      await getRedis().set(cacheKey, hand, { ex: PITCHER_HAND_TTL_SECONDS });
    } catch {
      /* ignore */
    }
  }
  return hand;
}

/** Probable starters for one game. Bulletproof: a null side just means "not announced yet" or a fetch failure — never throws. */
export async function getProbablePitchers(gamePk: number): Promise<ProbablePitchers> {
  const empty: ProbablePitchers = { home: null, away: null };
  if (!gamePk) return empty;

  const cacheKey = `mlb:pitchers:${gamePk}`;
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw !== null && raw !== undefined) return (typeof raw === 'string' ? JSON.parse(raw) : raw) as ProbablePitchers;
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  let result = empty;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${gamePk}&hydrate=probablePitcher`,
      { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      const g = data?.dates?.[0]?.games?.[0];
      const homeP = g?.teams?.home?.probablePitcher;
      const awayP = g?.teams?.away?.probablePitcher;
      const [homeHand, awayHand] = await Promise.all([
        homeP?.id ? fetchPitcherHand(homeP.id) : Promise.resolve(null),
        awayP?.id ? fetchPitcherHand(awayP.id) : Promise.resolve(null),
      ]);
      result = {
        home: homeP?.fullName ? { name: homeP.fullName, hand: homeHand } : null,
        away: awayP?.fullName ? { name: awayP.fullName, hand: awayHand } : null,
      };
    }
  } catch {
    result = empty;
  }

  try {
    await getRedis().set(cacheKey, JSON.stringify(result), { ex: PITCHERS_TTL_SECONDS });
  } catch {
    /* ignore */
  }

  return result;
}
