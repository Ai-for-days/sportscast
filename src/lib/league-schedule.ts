// League-wide upcoming schedule — every tracked game in a league within a
// rolling window, no matter which venue it's at, enriched with that venue's
// weather forecast and DraftKings lines.
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
//  - MLB: mlb-schedule.ts (MLB Stats API, not ESPN) — also carries probable
//    pitchers and live inning state, from the same range fetch.
//  - NFL / NCAA football / MLS+NWSL: venue-schedule.ts's per-LEAGUE cached
//    ESPN scoreboard fetch (getLeagueEvents) — one call per league, not per
//    team or per game.
//  - Odds: sportsbook-odds.ts's per-SPORT cached Odds API fetch.

import { venues, getVenueById, getMlbVenueByTeamName } from './venue-data';
import { getLeagueEvents } from './venue-schedule';
import { getUpcomingMlbGames, startOfTodayET, getRoofStatus, type ProbablePitcher } from './mlb-schedule';
import { getGameLines, oddsApiConfigured, type GameLines } from './sportsbook-odds';
import { getForecast } from './weather-queries';
import { getInningForecast } from './mlb-game-forecast';
import { buildGameWeatherNarrative, buildMlbGameWeatherNarrative } from './game-weather-narrative';
import type { Venue, ForecastResponse, DailyForecast } from './types';
import teamEspnIdsRaw from '../data/team-espn-ids.json';
import stadiumOrientations from '../data/stadium-orientations.json';

const stadiumBearings = stadiumOrientations as unknown as Record<string, number>;

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
for (const [venueId, espn] of Object.entries(teamEspnIds)) {
  const v = getVenueById(venueId);
  if (!v) continue;
  espnKeyToVenue.set(`${espn.leaguePath}:${espn.teamId}`, v);
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
  /** The away team's OWN park — for linking their name, not for this game's weather/odds. Null if they're not a venue we track. */
  awayVenue: Venue | null;
  // MLB only — null for ESPN-sourced leagues (NFL/NCAA/MLS).
  inning: number | null;
  inningState: string | null;
  homePitcher: ProbablePitcher | null;
  awayPitcher: ProbablePitcher | null;
}

async function getRawGames(league: SiteLeague, windowDays: number): Promise<RawGame[]> {
  const nowMs = Date.now();
  const floorMs = startOfTodayET(new Date(nowMs));
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
        awayVenue: getMlbVenueByTeamName(g.awayTeam) ?? null,
        inning: g.inning,
        inningState: g.inningState,
        homePitcher: g.homePitcher,
        awayPitcher: g.awayPitcher,
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
        if (!Number.isFinite(ms) || ms < floorMs || ms > cutoffMs) continue;
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
          awayVenue: espnKeyToVenue.get(`${lp}:${String(away?.team?.id ?? '')}`) ?? null,
          inning: null,
          inningState: null,
          homePitcher: null,
          awayPitcher: null,
        });
      }
      return out;
    }),
  );

  return perPath.flat().sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
}

// ── Public API ────────────────────────────────────────────────────────────

export interface FirstPitchWeather {
  tempF: number;
  windSpeedMph: number;
  windGustMph: number;
  /** Compass bearing the wind blows FROM (0 = N). */
  windDirectionDeg: number;
  precipProbability: number;
}

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
  awayVenue: Venue | null;
  weatherMatters: boolean;
  /** True when this specific game's retractable roof is confirmed closed —
   * only known/checked for today's games (see getRoofStatus). Weather
   * doesn't matter for a closed-roof game even though the park normally
   * plays outdoors. */
  roofClosed: boolean;
  day: DailyForecast | null;
  /** Prose write-up of conditions (MLB: innings 1-9; other leagues: kickoff
   * through +3.5h); null when the hourly forecast doesn't reach that far out
   * yet — falls back to `day`. */
  weatherNarrative: string | null;
  /** MLB only: conditions at first pitch, for the compact Weatherboard summary. */
  firstPitchWeather: FirstPitchWeather | null;
  lines: GameLines | null;
  // MLB only — null for ESPN-sourced leagues.
  inning: number | null;
  inningState: string | null;
  homePitcher: ProbablePitcher | null;
  awayPitcher: ProbablePitcher | null;
}

export interface ScheduleResult {
  games: EnrichedScheduleGame[];
  windowDays: number;
  truncated: boolean;
}

const MAX_RESULTS = 150;

/** Every tracked game in `league` starting within `windowDays`, enriched with venue weather and odds. Bulletproof — a failure in any one data source just leaves that field empty for the affected games. */
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

  // Roof status: only worth checking for a retractable-roof MLB game happening
  // TODAY — that's a per-game live-feed call, and the open/closed call is
  // usually made day-of anyway, so a game further out has nothing to know yet.
  const roofStatusByGameId = new Map<string, boolean>(); // true = confirmed closed
  if (league === 'mlb') {
    const todayFloorMs = startOfTodayET();
    const tomorrowFloorMs = todayFloorMs + 86400000;
    await Promise.all(
      limited.map(async (g) => {
        if (g.venue.type !== 'retractable') return;
        const ms = Date.parse(g.kickoffUTC);
        if (!Number.isFinite(ms) || ms < todayFloorMs || ms >= tomorrowFloorMs) return;
        const status = await getRoofStatus(Number(g.id)).catch(() => 'unknown' as const);
        if (status === 'closed') roofStatusByGameId.set(g.id, true);
      }),
    );
  }

  const games: EnrichedScheduleGame[] = limited.map((g, i) => {
    const roofClosed = roofStatusByGameId.get(g.id) ?? false;
    const weatherMatters = g.venue.type !== 'indoor' && !roofClosed;
    const f = weatherMatters ? forecasts.get(g.venue.id) : null;
    const day = f ? findDailyForDate(f, g.kickoffUTC) : null;
    const mlbSlots = (league === 'mlb' && f) ? getInningForecast(f.hourly, g.kickoffUTC, f.utcOffsetSeconds) : [];
    const weatherNarrative = f
      ? league === 'mlb'
        ? buildMlbGameWeatherNarrative({
            slots: mlbSlots,
            lat: g.venue.lat,
            lon: g.venue.lon,
            airQuality: f.airQuality ?? null,
            stadiumBearingDeg: stadiumBearings[g.venue.id],
          })
        : buildGameWeatherNarrative({
            hourly: f.hourly,
            kickoffUTC: g.kickoffUTC,
            utcOffsetSeconds: f.utcOffsetSeconds,
            lat: g.venue.lat,
            lon: g.venue.lon,
            airQuality: f.airQuality ?? null,
          })
      : null;
    const firstPitch = mlbSlots[0] ?? null;
    const firstPitchWeather: FirstPitchWeather | null = firstPitch
      ? {
          tempF: firstPitch.tempF,
          windSpeedMph: firstPitch.windSpeedMph,
          windGustMph: firstPitch.windGustMph,
          windDirectionDeg: firstPitch.windDirectionDeg,
          precipProbability: firstPitch.precipProbability,
        }
      : null;
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
      awayVenue: g.awayVenue,
      weatherMatters,
      roofClosed,
      day,
      weatherNarrative,
      firstPitchWeather,
      lines: lines[i] ?? null,
      inning: g.inning,
      inningState: g.inningState,
      homePitcher: g.homePitcher,
      awayPitcher: g.awayPitcher,
    };
  });

  return { games, windowDays, truncated };
}
