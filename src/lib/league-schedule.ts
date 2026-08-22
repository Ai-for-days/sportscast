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
import { getUpcomingMlbGames, startOfGameDayET, getRoofStatus, type ProbablePitcher } from './mlb-schedule';
import { getGameLines, oddsApiConfigured, getNflGamesFromOddsApi, getNflScoresFromOddsApi, type GameLines } from './sportsbook-odds';
import { getForecast } from './weather-queries';
import { getInningForecast } from './mlb-game-forecast';
import { buildGameWeatherNarrative, buildMlbGameWeatherNarrative } from './game-weather-narrative';
import { computeGameWes, getWesConfig, type WesResult, type WesConfig } from './wes';
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

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Team display name -> our tracked venue, NFL only. Used solely by the
// Odds-API schedule fallback below (keyed by name, not ESPN team ID, since
// that's all The Odds API gives us).
const nflTeamNameToVenue = new Map<string, Venue>();
for (const v of venues) {
  if (v.league === 'nfl' && v.team) nflTeamNameToVenue.set(normTeam(v.team), v);
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

export interface RawGame {
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
  const floorMs = startOfGameDayET(new Date(nowMs));
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

  let out = perPath.flat();

  // NFL-only fallback: ESPN's free scoreboard has repeatedly 403'd our
  // egress IP (see venue-schedule.ts's own comment on this), which — unlike
  // MLB's separate MLB-Stats-API path — takes the WHOLE NFL section dark
  // when it happens (Weatherboard, venue "Next Game" cards). We already
  // fetch The Odds API's own NFL game list for lines, so use it to fill in
  // any games ESPN's response is missing.
  if (league === 'nfl') {
    const [oddsGames, oddsScores] = await Promise.all([
      getNflGamesFromOddsApi().catch(() => []),
      getNflScoresFromOddsApi().catch(() => []),
    ]);
    out = mergeNflOddsFallback(out, oddsGames, floorMs, cutoffMs, nflTeamNameToVenue, oddsScores);
  }

  return out.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
}

/**
 * Fills in NFL games The Odds API knows about but ESPN's response is
 * missing from — deduped by team pair (ESPN's version always wins where
 * both have the same game, since it carries live score/state the Odds API
 * doesn't) and bounded to the same [floorMs, cutoffMs] window as the ESPN
 * games. `scores` (from the Odds API's separate /scores endpoint — see
 * getNflScoresFromOddsApi) fills in real state/score for each fallback game;
 * omit it (or pass []) and every fallback game is just 'pre' with no score,
 * as before. Pure and exported for unit testing.
 */
export function mergeNflOddsFallback(
  espnGames: RawGame[],
  oddsGames: { homeTeam: string; awayTeam: string; commenceTimeISO: string }[],
  floorMs: number,
  cutoffMs: number,
  teamNameToVenue: Map<string, Venue>,
  scores: { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; completed: boolean }[] = [],
): RawGame[] {
  const out = [...espnGames];
  const seen = new Set(out.map((g) => `${normTeam(g.homeTeam)}|${normTeam(g.awayTeam)}`));
  const scoreByPair = new Map(scores.map((s) => [`${normTeam(s.homeTeam)}|${normTeam(s.awayTeam)}`, s]));
  for (const og of oddsGames) {
    const ms = Date.parse(og.commenceTimeISO);
    if (!Number.isFinite(ms) || ms < floorMs || ms > cutoffMs) continue;
    const key = `${normTeam(og.homeTeam)}|${normTeam(og.awayTeam)}`;
    if (seen.has(key)) continue; // ESPN already has this game
    const venue = teamNameToVenue.get(normTeam(og.homeTeam));
    if (!venue) continue; // not a venue we track
    seen.add(key);
    const score = scoreByPair.get(key);
    const hasScore = !!score && (score.homeScore !== null || score.awayScore !== null);
    const state: RawGame['state'] = score?.completed ? 'post' : hasScore ? 'in' : 'pre';
    out.push({
      id: `odds-${key}-${ms}`,
      homeTeam: venue.team ?? og.homeTeam,
      awayTeam: og.awayTeam,
      kickoffUTC: og.commenceTimeISO,
      state,
      statusDetail: state === 'post' ? 'Final' : state === 'in' ? 'In Progress' : '',
      homeScore: score?.homeScore ?? null,
      awayScore: score?.awayScore ?? null,
      venue,
      awayVenue: teamNameToVenue.get(normTeam(og.awayTeam)) ?? null,
      inning: null,
      inningState: null,
      homePitcher: null,
      awayPitcher: null,
    });
  }
  return out;
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
  /** Weather Experience Score (see wes.ts) — null when weather doesn't matter (indoor/roof-closed) or the hourly forecast doesn't reach this game yet. */
  wes: WesResult | null;
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

/**
 * Manual override (2026-08-21, per Derek): Houston, Texas, and Arizona are
 * expected to keep their retractable roofs closed for the rest of THIS MLB
 * season (summer heat) — treated as closed for every remaining game, not
 * just today's, unlike the live per-game check below (which only ever knows
 * about today anyway). Revisit/remove next season, or sooner if one of
 * these teams starts playing with the roof open again.
 */
const SEASON_CLOSED_ROOF_VENUES = new Set(['mlb-hou', 'mlb-tex', 'mlb-ari']);

/**
 * Every tracked game in `league` starting within `windowDays`, enriched with
 * venue weather and odds. Bulletproof — a failure in any one data source
 * just leaves that field empty for the affected games.
 *
 * `teamFilter` (added 2026-08-21): when a caller only cares about ONE
 * team's games — venue pages, building their "Next Game"/"Next Home Game"
 * cards — narrow to that team's games BEFORE the per-venue weather fetch
 * below. Without this, a venue page calling getScheduleGames('mlb', 7) to
 * find its own team's next 1-2 games was fetching weather for every unique
 * venue with ANY game in the next 7 days (~25 venues across the league) —
 * confirmed in production hammering Open-Meteo into 429s and driving
 * 16-24s page loads. With a team filter, the same call only ever touches
 * that team's own park plus whichever 1-3 opponents' parks it visits that
 * week. The Weatherboard (which genuinely needs every game) simply omits
 * this param and is unaffected.
 */
export async function getScheduleGames(league: SiteLeague, windowDays: number, teamFilter?: string): Promise<ScheduleResult> {
  const rawAll = await getRawGames(league, windowDays).catch(() => [] as RawGame[]);
  const raw = teamFilter ? rawAll.filter((g) => g.homeTeam === teamFilter || g.awayTeam === teamFilter) : rawAll;
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
  const wesConfig: WesConfig = await getWesConfig();

  // Odds: one lookup per game, but each hits an already-cached per-sport list.
  const lines = oddsApiConfigured()
    ? await Promise.all(limited.map((g) => getGameLines(league, g.homeTeam, g.awayTeam, g.kickoffUTC).catch(() => null)))
    : limited.map(() => null);

  // Roof status: only worth checking for a retractable-roof MLB game happening
  // TODAY — that's a per-game live-feed call, and the open/closed call is
  // usually made day-of anyway, so a game further out has nothing to know yet.
  const roofStatusByGameId = new Map<string, boolean>(); // true = confirmed closed
  if (league === 'mlb') {
    const todayFloorMs = startOfGameDayET();
    const tomorrowFloorMs = todayFloorMs + 86400000;
    await Promise.all(
      limited.map(async (g) => {
        if (g.venue.type !== 'retractable' || SEASON_CLOSED_ROOF_VENUES.has(g.venue.id)) return;
        const ms = Date.parse(g.kickoffUTC);
        if (!Number.isFinite(ms) || ms < todayFloorMs || ms >= tomorrowFloorMs) return;
        const status = await getRoofStatus(Number(g.id)).catch(() => 'unknown' as const);
        if (status === 'closed') roofStatusByGameId.set(g.id, true);
      }),
    );
  }

  const games: EnrichedScheduleGame[] = limited.map((g, i) => {
    const roofClosed = SEASON_CLOSED_ROOF_VENUES.has(g.venue.id) || (roofStatusByGameId.get(g.id) ?? false);
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
    const wes = f
      ? computeGameWes(f.hourly, g.kickoffUTC, f.utcOffsetSeconds, g.venue.lat, g.venue.lon, f.alerts ?? [], wesConfig)
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
      wes,
      lines: lines[i] ?? null,
      inning: g.inning,
      inningState: g.inningState,
      homePitcher: g.homePitcher,
      awayPitcher: g.awayPitcher,
    };
  });

  return { games, windowDays, truncated };
}

/** The single source of truth for "what does the Weather column say" — used
 * by both the Weatherboard and any other page (e.g. a venue page's next-game
 * card) that shows one of these games, so they never disagree. */
export function describeGameWeather(g: Pick<EnrichedScheduleGame, 'roofClosed' | 'weatherMatters' | 'weatherNarrative' | 'day'>): string {
  if (g.roofClosed) return 'Roof closed — weather is not a factor for this game.';
  if (!g.weatherMatters) return 'Indoors';
  if (g.weatherNarrative) return g.weatherNarrative;
  if (!g.day) return '—';
  return `${Math.round(g.day.highF)}°/${Math.round(g.day.lowF)}° · ${Math.round(g.day.windSpeedMph)}mph wind · ${g.day.precipProbability}% precip.`;
}
