// League-wide upcoming schedule — every tracked game in a league within a
// rolling window, no matter which venue it's at, enriched with that venue's
// weather forecast, DraftKings/FanDuel lines, and reported injuries.
//
// Scoped to venues we actually track (venue-data.ts): a game only appears
// once its home team resolves to one of our tracked venues, via the same
// team-espn-ids.json mapping venue pages already use. That keeps the page
// bounded (not literally every FBS/FCS or NWSL matchup on Earth) while still
// covering every MLB, NFL, MLS/NWSL, and major-conference NCAA football team
// we have a venue for.
//
// Data sources, each already-established elsewhere in this codebase and
// reused as-is (not new fetch patterns, to avoid repeating the ESPN
// rate-limiting incident from 2026-08-19 — see venue-schedule.ts):
//  - MLB: mlb-schedule.ts (MLB Stats API, not ESPN)
//  - NFL / NCAA football / MLS+NWSL: venue-schedule.ts's per-LEAGUE cached
//    ESPN scoreboard fetch (getLeagueEvents) — one call per league, not per
//    team or per game.
//  - Odds: sportsbook-odds.ts's per-SPORT cached Odds API fetch.
//  - Injuries: ESPN's per-LEAGUE injuries endpoint (new here, same one-call-
//    per-league shape as the schedule fetch — never per team).

import { venues, getVenueById, getMlbVenueByTeamName } from './venue-data';
import { getLeagueEvents } from './venue-schedule';
import { getUpcomingMlbGames } from './mlb-schedule';
import { getGameLines, oddsApiConfigured, type GameLines } from './sportsbook-odds';
import { getForecast } from './weather-queries';
import { getRedis } from './redis';
import type { Venue, ForecastResponse, DailyForecast } from './types';
import teamEspnIdsRaw from '../data/team-espn-ids.json';

export type SiteLeague = 'mlb' | 'nfl' | 'ncaa-football' | 'mls';

const teamEspnIds = teamEspnIdsRaw as Record<string, { leaguePath: string; teamId: string }>;

// ESPN league path(s) that back each site league. MLS's venue pool covers
// both MLS and NWSL teams (see venue-data.ts), so its schedule pulls both.
const LEAGUE_PATHS: Record<Exclude<SiteLeague, 'mlb'>, string[]> = {
  nfl: ['football/nfl'],
  'ncaa-football': ['football/college-football'],
  mls: ['soccer/usa.1', 'soccer/usa.nwsl'],
};

// `${leaguePath}:${espnTeamId}` -> our tracked venue for that team.
const espnKeyToVenue = new Map<string, Venue>();
// normalized team display name -> espn league/team id, for injury lookups on
// whichever side (home or away) isn't already resolved via a tracked venue.
const teamNameToEspn = new Map<string, { leaguePath: string; teamId: string }>();
for (const [venueId, espn] of Object.entries(teamEspnIds)) {
  const v = getVenueById(venueId);
  if (!v) continue;
  espnKeyToVenue.set(`${espn.leaguePath}:${espn.teamId}`, v);
  if (v.team) teamNameToEspn.set(normTeam(v.team), espn);
}

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function localDateOf(iso: string, utcOffsetSeconds: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
}

function findDailyForDate(f: ForecastResponse, kickoffUTC: string): DailyForecast | null {
  const dateStr = localDateOf(kickoffUTC, f.utcOffsetSeconds);
  return (f.daily ?? []).find((d) => d.date === dateStr) ?? null;
}

// ── Injuries (one fetch per ESPN league, cached) ────────────────────────

export interface InjuryEntry {
  playerName: string;
  status: string;
  comment: string;
}

const INJURIES_TTL_SECONDS = 1800; // 30 min — statuses (Q/D/O) change daily during a game week
const INJURIES_FAILURE_BACKOFF_SECONDS = 180;

async function fetchLeagueInjuries(leaguePath: string): Promise<Map<string, InjuryEntry[]> | null> {
  const cacheKey = `injuries:league:${leaguePath}`;
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw !== null && raw !== undefined) {
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, InjuryEntry[]>;
      return new Map(Object.entries(parsed));
    }
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  let byTeam: Record<string, InjuryEntry[]> | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/injuries`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WagerOnWeather/1.0' },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      byTeam = {};
      for (const team of data?.injuries ?? []) {
        const id = String(team?.id ?? '');
        if (!id) continue;
        byTeam[id] = (team?.injuries ?? []).slice(0, 5).map((inj: any) => ({
          playerName: inj?.athlete?.displayName ?? 'Unknown player',
          status: inj?.status ?? '',
          comment: inj?.shortComment ?? inj?.longComment ?? '',
        }));
      }
    }
  } catch {
    byTeam = null;
  }

  try {
    const ttl = byTeam !== null ? INJURIES_TTL_SECONDS : INJURIES_FAILURE_BACKOFF_SECONDS;
    await getRedis().set(cacheKey, JSON.stringify(byTeam ?? {}), { ex: ttl });
  } catch {
    /* ignore */
  }

  return byTeam ? new Map(Object.entries(byTeam)) : null;
}

// ── Raw schedule per league ──────────────────────────────────────────────

interface RawGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUTC: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: Venue;
}

async function getRawGames(league: SiteLeague, windowDays: number): Promise<RawGame[]> {
  const nowMs = Date.now();
  const cutoffMs = nowMs + windowDays * 86400000;

  if (league === 'mlb') {
    const games = await getUpcomingMlbGames(windowDays);
    const out: RawGame[] = [];
    for (const g of games) {
      const venue = getMlbVenueByTeamName(g.homeTeam);
      if (!venue) continue;
      out.push({
        id: String(g.gamePk),
        homeTeam: venue.team ?? g.homeTeam,
        awayTeam: g.awayTeam,
        kickoffUTC: g.kickoffUTC,
        state: g.state,
        statusDetail: g.statusDetail,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        venue,
      });
    }
    return out;
  }

  const leaguePaths = LEAGUE_PATHS[league];
  const perPath = await Promise.all(
    leaguePaths.map(async (lp) => {
      const events = await getLeagueEvents(lp);
      if (!events) return [];
      const out: RawGame[] = [];
      for (const ev of events) {
        const comp = ev?.competitions?.[0];
        if (!comp) continue;
        const competitors = comp?.competitors ?? [];
        const home = competitors.find((c: any) => c?.homeAway === 'home');
        const away = competitors.find((c: any) => c?.homeAway === 'away');
        if (!home || !away) continue;
        const ms = Date.parse(ev?.date ?? comp?.date ?? '');
        if (!Number.isFinite(ms) || ms < nowMs || ms > cutoffMs) continue;
        const venue = espnKeyToVenue.get(`${lp}:${String(home?.team?.id ?? '')}`);
        if (!venue) continue; // only games at venues we track
        const homeScoreNum = Number(home?.score);
        const awayScoreNum = Number(away?.score);
        out.push({
          id: String(ev?.id ?? `${lp}-${ms}`),
          homeTeam: venue.team ?? home?.team?.displayName ?? '',
          awayTeam: away?.team?.displayName ?? '',
          kickoffUTC: ev?.date ?? comp?.date ?? '',
          state: comp?.status?.type?.state === 'in' || comp?.status?.type?.state === 'post' ? comp.status.type.state : 'pre',
          statusDetail: comp?.status?.type?.shortDetail ?? comp?.status?.type?.description ?? '',
          homeScore: Number.isFinite(homeScoreNum) ? homeScoreNum : null,
          awayScore: Number.isFinite(awayScoreNum) ? awayScoreNum : null,
          venue,
        });
      }
      return out;
    }),
  );

  return perPath.flat().sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
}

// ── Public API ────────────────────────────────────────────────────────────

export interface EnrichedScheduleGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffUTC: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: Venue;
  weatherMatters: boolean;
  day: DailyForecast | null;
  lines: GameLines | null;
  homeInjuries: InjuryEntry[];
  awayInjuries: InjuryEntry[];
}

export interface ScheduleResult {
  games: EnrichedScheduleGame[];
  windowDays: number;
  truncated: boolean;
}

const MAX_RESULTS = 150;

/** Every tracked game in `league` starting within `windowDays`, enriched with venue weather, odds, and injuries. Bulletproof — a failure in any one data source just leaves that field empty for the affected games. */
export async function getScheduleGames(league: SiteLeague, windowDays: number): Promise<ScheduleResult> {
  const raw = await getRawGames(league, windowDays).catch(() => [] as RawGame[]);
  const truncated = raw.length > MAX_RESULTS;
  const limited = raw.slice(0, MAX_RESULTS);

  // Weather: one fetch per unique open-air/retractable venue in play.
  const uniqueVenues = new Map<string, Venue>();
  for (const g of limited) {
    if (g.venue.type !== 'indoor' && !uniqueVenues.has(g.venue.id)) uniqueVenues.set(g.venue.id, g.venue);
  }
  const forecastEntries = await Promise.all(
    [...uniqueVenues.values()].map(async (v) => {
      try {
        return [v.id, await getForecast(v.lat, v.lon, 16)] as const;
      } catch {
        return [v.id, null] as const;
      }
    }),
  );
  const forecasts = new Map(forecastEntries);

  // Odds: one lookup per game, but each hits an already-cached per-sport list.
  const lines = oddsApiConfigured()
    ? await Promise.all(limited.map((g) => getGameLines(league, g.homeTeam, g.awayTeam, g.kickoffUTC).catch(() => null)))
    : limited.map(() => null);

  // Injuries: one fetch per ESPN league path involved.
  const leaguePaths = league === 'mlb' ? ['baseball/mlb'] : LEAGUE_PATHS[league];
  const injuryMapEntries = await Promise.all(leaguePaths.map((lp) => fetchLeagueInjuries(lp)));
  const mergedInjuries = new Map<string, InjuryEntry[]>();
  for (const m of injuryMapEntries) {
    if (!m) continue;
    for (const [k, v] of m) mergedInjuries.set(k, v);
  }

  const games: EnrichedScheduleGame[] = limited.map((g, i) => {
    const weatherMatters = g.venue.type !== 'indoor';
    const f = weatherMatters ? forecasts.get(g.venue.id) : null;
    const day = f ? findDailyForDate(f, g.kickoffUTC) : null;
    const homeEspn = teamNameToEspn.get(normTeam(g.homeTeam));
    const awayEspn = teamNameToEspn.get(normTeam(g.awayTeam));
    return {
      id: g.id,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      kickoffUTC: g.kickoffUTC,
      state: g.state,
      statusDetail: g.statusDetail,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      venue: g.venue,
      weatherMatters,
      day,
      lines: lines[i] ?? null,
      homeInjuries: homeEspn ? mergedInjuries.get(homeEspn.teamId) ?? [] : [],
      awayInjuries: awayEspn ? mergedInjuries.get(awayEspn.teamId) ?? [] : [],
    };
  });

  return { games, windowDays, truncated };
}
