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
import { formatLivePeriodClock, type EspnPeriodStyle } from './espn-scoreboard';
import { getUpcomingMlbGames, startOfGameDayET, getRoofStatus, type ProbablePitcher } from './mlb-schedule';
import { getGameLines, oddsApiConfigured, getOddsApiEvents, getOddsApiScores, type GameLines, type OddsScheduleGame } from './sportsbook-odds';
import { getForecast } from './weather-queries';
import { getInningForecast, getGameWindowForecast } from './mlb-game-forecast';
import { getQuarterForecast } from './football-game-forecast';
import { getFootballFieldAxis } from './football-stadium-orientation';
import { buildGameWeatherNarrative, buildMlbGameWeatherNarrative, buildFootballGameWeatherNarrative } from './game-weather-narrative';
import { computeGameWes, getWesConfig, type WesResult, type WesConfig } from './wes';
import { saveKickoffSnapshot, getForecastAccuracyWriteup, getActualConditionsSummary } from './game-forecast-accuracy';
import { getRoofOverrides } from './roof-override';
import { rotationKey, getRememberedRotations, rememberRotations, withRememberedRotations } from './rotation-numbers';
import type { Venue, ForecastResponse, DailyForecast } from './types';
import teamEspnIdsRaw from '../data/team-espn-ids.json';
import stadiumOrientations from '../data/stadium-orientations.json';

const stadiumBearings = stadiumOrientations as unknown as Record<string, number>;
const FOOTBALL_LEAGUES: ReadonlySet<SiteLeague> = new Set(['nfl', 'ncaa-football']);

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

/** ESPN-sourced leagues count their periods differently; MLB never reaches
 * here (it carries an inning/inningState pair from the MLB Stats API). */
function periodStyleFor(league: SiteLeague): EspnPeriodStyle {
  return league === 'mls' ? 'soccer' : 'football';
}

// SiteLeague -> team display name -> our tracked venue. Used solely by the
// Odds-API schedule fallback below (keyed by name, not ESPN team ID, since
// that's all The Odds API gives us). One map per ESPN-sourced league (NFL,
// NCAA football, MLS — MLB routes through mlb-schedule.ts instead, no
// fallback needed there). MLS's map covers NWSL team names too (same
// venue-data `league: 'mls'` pool) even though the Odds API has no NWSL
// key to ever actually surface an NWSL game through this fallback.
const teamNameToVenueByLeague = new Map<Exclude<SiteLeague, 'mlb'>, Map<string, Venue>>();
for (const leagueKey of Object.keys(LEAGUE_PATHS) as Exclude<SiteLeague, 'mlb'>[]) {
  const m = new Map<string, Venue>();
  for (const v of venues) {
    if (v.league === leagueKey && v.team) m.set(normTeam(v.team), v);
  }
  teamNameToVenueByLeague.set(leagueKey, m);
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
  /** NFL/NCAA/MLS "point in the game" (e.g. "Q3 6:49", "2nd Half 71:12") —
   * MLB's equivalent is the inning/inningState pair above instead. Null when
   * not live, or when the source (Odds-API fallback) doesn't carry it. */
  livePeriodClock: string | null;
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
        livePeriodClock: null,
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
        const espnState = comp?.status?.type?.state === 'in' || comp?.status?.type?.state === 'post' ? comp.status.type.state : 'pre';
        out.push({
          id: String(ev?.id ?? `${lp}-${ms}`),
          homeTeam: venue.team ?? home?.team?.displayName ?? '',
          awayTeam: away?.team?.displayName ?? '',
          kickoffUTC: ev?.date ?? comp?.date ?? '',
          state: espnState,
          statusDetail: comp?.status?.type?.shortDetail ?? comp?.status?.type?.description ?? '',
          homeScore: Number.isFinite(homeScoreNum) ? homeScoreNum : null,
          awayScore: Number.isFinite(awayScoreNum) ? awayScoreNum : null,
          venue,
          awayVenue: espnKeyToVenue.get(`${lp}:${String(away?.team?.id ?? '')}`) ?? null,
          inning: null,
          inningState: null,
          homePitcher: null,
          awayPitcher: null,
          livePeriodClock: espnState === 'in' ? formatLivePeriodClock(periodStyleFor(league), comp?.status?.period, comp?.status?.displayClock) : null,
        });
      }
      return out;
    }),
  );

  let out = perPath.flat();

  // ESPN-sourced-league fallback (NFL, NCAA football, MLS — MLB, which
  // routes through the separate MLB Stats API, already returned above):
  // ESPN's free scoreboard has repeatedly 403'd our egress IP (see
  // venue-schedule.ts's own comment on this), which takes that WHOLE
  // league's section dark when it happens (Weatherboard, venue "Next Game"
  // cards). getOddsApiEvents (The Odds API's free /events endpoint) covers
  // the WHOLE known schedule for every one of these leagues — a much longer
  // horizon than the /odds endpoint used for lines (which only lists a game
  // once a bookmaker has posted odds, typically a few weeks out) — so use
  // it to fill in any games ESPN's response is missing. A league with no
  // Odds API key (NWSL — see SPORT_KEYS) just gets back [] and this is a
  // no-op.
  {
    const teamNameToVenue = teamNameToVenueByLeague.get(league) ?? new Map<string, Venue>();
    const oddsGames = await getOddsApiEvents(league).catch(() => []); // free — always safe to check
    const seenPairs = new Set(out.map((g) => `${normTeam(g.homeTeam)}|${normTeam(g.awayTeam)}`));
    // getOddsApiScores costs real credits (2 per sport key, see sportsbook-
    // odds.ts) — only pay for it when there's an actual gap worth filling.
    // See hasScoreGap's own doc comment for the two live incidents (2026-08-23,
    // 2026-08-24) that shaped this gate.
    const hasGap = hasScoreGap(oddsGames, seenPairs, teamNameToVenue, floorMs, nowMs);
    const oddsScores = hasGap ? await getOddsApiScores(league).catch(() => []) : [];
    out = mergeOddsScheduleFallback(out, oddsGames, floorMs, cutoffMs, teamNameToVenue, oddsScores);
  }

  return out.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
}

/**
 * Is it worth PAYING for the Odds API's metered /scores endpoint right now?
 * Only true when a game The Odds API knows about, that ESPN's response is
 * missing, has ALREADY started (commenceTimeISO <= nowMs) — that's the one
 * scenario the fallback exists for (an ESPN outage/gap on a live or just-
 * finished game). A future game that hasn't kicked off yet has no live/final
 * score to fetch anyway; the free mergeOddsScheduleFallback below already
 * adds it correctly as 'pre' with no score, at zero cost.
 *
 * Reported live (2026-08-24): before this was split out, the equivalent
 * inline check scanned the FULL lookahead window (up to `cutoffMs`, which
 * can be 16-60 days out for the auto-pricing cron and calendar navigation)
 * instead of stopping at `nowMs` — and the Odds API's free /events endpoint
 * lists a league's WHOLE season months in advance (see fetchSportEvents's
 * own comment). Before NFL's regular season or NCAA Football's season had
 * even started, essentially every future game looked "missing" from ESPN's
 * near-term/off-season-empty scoreboard — not an outage, just normal
 * off-season quiet — so this fired on nearly every schedule fetch: 400
 * credits burned on Scores alone in one 200-request rolling log window
 * (146 of them NCAA Football, which hadn't played a single game yet).
 *
 * Pure and exported for unit testing. League-agnostic — used for NFL, NCAA
 * football, and MLS.
 */
export function hasScoreGap(
  oddsGames: OddsScheduleGame[],
  seenPairs: ReadonlySet<string>,
  teamNameToVenue: ReadonlyMap<string, Venue>,
  floorMs: number,
  nowMs: number,
): boolean {
  return oddsGames.some((og) => {
    const ms = Date.parse(og.commenceTimeISO);
    if (!Number.isFinite(ms) || ms < floorMs || ms > nowMs) return false;
    const key = `${normTeam(og.homeTeam)}|${normTeam(og.awayTeam)}`;
    return !seenPairs.has(key) && teamNameToVenue.has(normTeam(og.homeTeam));
  });
}

/**
 * Fills in games The Odds API knows about but ESPN's response is missing
 * from — deduped by team pair (ESPN's version always wins where both have
 * the same game, since it carries live score/state the Odds API doesn't)
 * and bounded to the same [floorMs, cutoffMs] window as the ESPN games.
 * `scores` (from the Odds API's separate /scores endpoint — see
 * getOddsApiScores) fills in real state/score for each fallback game; omit
 * it (or pass []) and every fallback game is just 'pre' with no score, as
 * before. Pure and exported for unit testing. League-agnostic — used for
 * NFL, NCAA football, and MLS.
 */
/**
 * Two games at the same venue this close together are the same game.
 *
 * Matching on team names alone put the SAME game on the board twice, once from
 * each source, whenever they spell a school differently. Live on 2026-08-31,
 * the NCAA board for September 3 showed:
 *
 *   6:00pm  Massachusetts Minutemen @ Rutgers   (ESPN, id 401858423)
 *   6:00pm  UMass Minutemen @ Rutgers           (Odds API fallback)
 *   7:00pm  UAlbany Great Danes @ Buffalo       (ESPN)
 *   7:00pm  Albany @ Buffalo                    (Odds API fallback)
 *
 * It only appeared once ESPN started answering again (the mirror-host fix
 * earlier the same day). While ESPN was 403ing there was one source, so there
 * was nothing to disagree with. An alias list would have to grow forever;
 * where and when a game is played is the thing both sources actually agree on.
 *
 * 90 minutes is comfortably wider than any disagreement between the two feeds
 * and comfortably narrower than a doubleheader, whose games sit hours apart.
 */
const SAME_GAME_TOLERANCE_MS = 90 * 60 * 1000;

export function mergeOddsScheduleFallback(
  espnGames: RawGame[],
  oddsGames: { homeTeam: string; awayTeam: string; commenceTimeISO: string }[],
  floorMs: number,
  cutoffMs: number,
  teamNameToVenue: Map<string, Venue>,
  scores: { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; completed: boolean }[] = [],
): RawGame[] {
  const out = [...espnGames];
  const seen = new Set(out.map((g) => `${normTeam(g.homeTeam)}|${normTeam(g.awayTeam)}`));
  // Where and when, alongside who. See SAME_GAME_TOLERANCE_MS.
  const placed: { venueId: string; ms: number }[] = out
    .map((g) => ({ venueId: g.venue.id, ms: Date.parse(g.kickoffUTC) }))
    .filter((p) => Number.isFinite(p.ms));
  const scoreByPair = new Map(scores.map((s) => [`${normTeam(s.homeTeam)}|${normTeam(s.awayTeam)}`, s]));
  for (const og of oddsGames) {
    const ms = Date.parse(og.commenceTimeISO);
    if (!Number.isFinite(ms) || ms < floorMs || ms > cutoffMs) continue;
    const key = `${normTeam(og.homeTeam)}|${normTeam(og.awayTeam)}`;
    if (seen.has(key)) continue; // ESPN already has this game, by name
    const venue = teamNameToVenue.get(normTeam(og.homeTeam));
    if (!venue) continue; // not a venue we track
    // ...and by place and time, which is what actually identifies a game.
    if (placed.some((p) => p.venueId === venue.id && Math.abs(p.ms - ms) <= SAME_GAME_TOLERANCE_MS)) continue;
    seen.add(key);
    placed.push({ venueId: venue.id, ms });
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
      // The Odds API's /scores endpoint carries a score but no period/clock —
      // honest to leave this null rather than show a fake "In Progress" badge.
      livePeriodClock: null,
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
  /** NFL/NCAA/MLS "point in the game" — see RawGame's own field comment. */
  livePeriodClock: string | null;
  /** Once the game is final: a neutral write-up comparing our kickoff
   * forecast to what actually happened, per NWS observations — see
   * game-forecast-accuracy.ts. Null pre-game, live, or when there's nothing
   * to compare (no snapshot was ever saved, or the venue's station/
   * observation couldn't be resolved). */
  forecastAccuracyWriteup: string | null;
  /** Once the game is final, when there's no snapshot for the fuller
   * accuracy write-up above: a plain statement of the actual NWS-observed
   * conditions at kickoff, so a finished game never falls back to
   * pre-game forecast language (e.g. a stale "% chance of precip", which
   * makes no sense after the fact). Null pre-game, live, or when the
   * venue's station/observation couldn't be resolved. */
  actualConditionsSummary: string | null;
}

export interface ScheduleResult {
  games: EnrichedScheduleGame[];
  windowDays: number;
  truncated: boolean;
}

const MAX_RESULTS = 150;

/**
 * Manual season-long roof override, applied to every league (checked below
 * regardless of `league`) — for a venue where no live per-game roof check
 * exists (only MLB has one, via getRoofStatus) or where Derek has told us
 * the roof is staying in one position for a stretch longer than a live
 * per-game check would ever know about:
 *  - Houston, Texas, Arizona (MLB) — 2026-08-21: expected to keep their
 *    retractable roofs closed for the rest of THIS MLB season (summer
 *    heat). Revisit/remove next season, or sooner if one of these teams
 *    starts playing with the roof open again.
 *  - Atlanta United (MLS, Mercedes-Benz Stadium) — 2026-08-23, per Derek:
 *    closed for the rest of the MLS season. There is no live roof-status
 *    API for MLS (confirmed: ESPN's soccer scoreboard carries no roof/
 *    indoor field at all, unlike MLB's dedicated live-feed endpoint), so
 *    this manual call is the only signal available. Revisit if that
 *    changes or the team plays with it open again.
 */
const SEASON_CLOSED_ROOF_VENUES = new Set(['mlb-hou', 'mlb-tex', 'mlb-ari', 'mls-atl', 'mls-van']);

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
export async function getScheduleGames(league: SiteLeague, windowDays: number, teamFilter?: string, opts?: { skipForecastCache?: boolean; lite?: boolean }): Promise<ScheduleResult> {
  const rawAll = await getRawGames(league, windowDays).catch(() => [] as RawGame[]);
  const raw = teamFilter ? rawAll.filter((g) => g.homeTeam === teamFilter || g.awayTeam === teamFilter) : rawAll;
  const truncated = raw.length > MAX_RESULTS;
  const limited = raw.slice(0, MAX_RESULTS);

  // `lite: true` (added 2026-08-25): skip every bit of DISPLAY enrichment
  // below (per-venue forecast fetch, WES, weather narrative, odds/lines,
  // live roof-status check, kickoff snapshots) for a caller that only
  // needs game identity/venue/kickoff data, not what the Weatherboard shows.
  // Added for the automated market-pricing engines (auto-hvl-market.ts and
  // friends): each one calls getScheduleGames() with no teamFilter (they
  // need every game), and the full enrichment path fetches forecasts,
  // odds, and live roof status for every game in the league on every single
  // cron tick, exactly the "no team filter, whole league" pattern the
  // 2026-08-21 comment above already identified as hammering Open-Meteo
  // into 429s. Confirmed live 2026-08-25: 37 straight 504 timeouts in 24h
  // on /api/cron/auto-hvl-pricing, well before today's 3 new engines even
  // existed. This was already failing most of the time, it just wasn't
  // being watched closely since HvL's occasional lucky success looked like
  // "working." None of the 4 pricing engines read `day`/`weatherNarrative`/
  // `wes`/`lines`/`firstPitchWeather`/`forecastAccuracyWriteup`; they only
  // use `venue`/`awayVenue`/`kickoffUTC`/`state`/`id`, and fetch their own
  // targeted per-venue forecast afterward.
  if (opts?.lite) {
    const games: EnrichedScheduleGame[] = limited.map((g) => ({
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
      weatherMatters: g.venue.type !== 'indoor',
      roofClosed: false,
      day: null,
      weatherNarrative: null,
      firstPitchWeather: null,
      wes: null,
      lines: null,
      inning: g.inning,
      inningState: g.inningState,
      homePitcher: g.homePitcher,
      awayPitcher: g.awayPitcher,
      livePeriodClock: g.livePeriodClock,
      forecastAccuracyWriteup: null,
      actualConditionsSummary: null,
    }));
    return { games, windowDays, truncated };
  }

  // Weather: one fetch per unique open-air/retractable venue in play.
  const uniqueVenues = new Map<string, Venue>();
  for (const g of limited) {
    if (g.venue.type !== 'indoor' && !uniqueVenues.has(g.venue.id)) uniqueVenues.set(g.venue.id, g.venue);
  }
  // Reported 2026-08-23: a handful of venues (usually the less-visited ones,
  // with a cold cache) came back blank on a page that fetches many venues'
  // forecasts at once — a page like the bare /weatherboard hits every
  // league's unique venues in one burst of concurrent requests, and a
  // transient upstream hiccup under that load took out just those few. One
  // retry after a short delay is cheap insurance against exactly that,
  // without adding real latency to the common (already-cached) case.
  const forecastEntries = await Promise.all(
    [...uniqueVenues.values()].map(async (v) => {
      try {
        return [v.id, await getForecast(v.lat, v.lon, 16, { skipCache: opts?.skipForecastCache })] as const;
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return [v.id, await getForecast(v.lat, v.lon, 16, { skipCache: opts?.skipForecastCache })] as const;
        } catch {
          return [v.id, null] as const;
        }
      }
    }),
  );
  const forecasts = new Map(forecastEntries);
  const wesConfig: WesConfig = await getWesConfig();

  // Odds: one lookup per game, but each hits an already-cached per-sport list.
  const liveLines = oddsApiConfigured()
    ? await Promise.all(limited.map((g) => getGameLines(league, g.homeTeam, g.awayTeam, g.kickoffUTC).catch(() => null)))
    : limited.map(() => null);

  // Rotation numbers outlive the market that carried them. Per Derek: "don't
  // erase the rotation numbers when the games end." The Odds API drops a game
  // from /odds once it is under way, which took the whole lines object with it
  // and blanked the board's `#` column on every finished game. See
  // rotation-numbers.ts — a rotation number is an identifier, not a price.
  const rotationKeys = limited.map((g) => rotationKey(g.venue.id, g.kickoffUTC));
  const remembered = await getRememberedRotations(rotationKeys);
  await rememberRotations(
    liveLines.map((l, i) => ({
      key: rotationKeys[i],
      pair: { home: l?.homeRotation ?? null, away: l?.awayRotation ?? null },
    })),
  );
  const lines = liveLines.map((l, i) => {
    const key = rotationKeys[i];
    return withRememberedRotations(l, key ? remembered.get(key) : undefined);
  });

  // Manual admin override (/admin/system/roof-status) — always wins over
  // everything below, since it's the most current information there is for
  // every league besides MLB's own live check. See roof-override.ts.
  const retractableVenueIds = [...new Set(limited.filter((g) => g.venue.type === 'retractable').map((g) => g.venue.id))];
  const roofOverrides = await getRoofOverrides(retractableVenueIds);

  // Roof status: only worth checking for a retractable-roof MLB game happening
  // TODAY — that's a per-game live-feed call, and the open/closed call is
  // usually made day-of anyway, so a game further out has nothing to know yet.
  const roofStatusByGameId = new Map<string, boolean>(); // true = confirmed closed
  if (league === 'mlb') {
    const todayFloorMs = startOfGameDayET();
    const tomorrowFloorMs = todayFloorMs + 86400000;
    await Promise.all(
      limited.map(async (g) => {
        if (g.venue.type !== 'retractable' || roofOverrides.has(g.venue.id) || SEASON_CLOSED_ROOF_VENUES.has(g.venue.id)) return;
        const ms = Date.parse(g.kickoffUTC);
        if (!Number.isFinite(ms) || ms < todayFloorMs || ms >= tomorrowFloorMs) return;
        const status = await getRoofStatus(Number(g.id)).catch(() => 'unknown' as const);
        if (status === 'closed') roofStatusByGameId.set(g.id, true);
      }),
    );
  }

  const games: EnrichedScheduleGame[] = await Promise.all(limited.map(async (g, i) => {
    const override = roofOverrides.get(g.venue.id);
    const roofClosed = override
      ? override === 'closed'
      : SEASON_CLOSED_ROOF_VENUES.has(g.venue.id) || (roofStatusByGameId.get(g.id) ?? false);
    const weatherMatters = g.venue.type !== 'indoor' && !roofClosed;
    const f = weatherMatters ? forecasts.get(g.venue.id) : null;
    const day = f ? findDailyForDate(f, g.kickoffUTC) : null;
    const mlbSlots = (league === 'mlb' && f) ? getInningForecast(f.hourly, g.kickoffUTC, f.utcOffsetSeconds) : [];
    const footballSlots = (FOOTBALL_LEAGUES.has(league) && f) ? getQuarterForecast(f.hourly, g.kickoffUTC, f.utcOffsetSeconds) : [];
    const weatherNarrative = f
      ? league === 'mlb'
        ? buildMlbGameWeatherNarrative({
            slots: mlbSlots,
            lat: g.venue.lat,
            lon: g.venue.lon,
            airQuality: f.airQuality ?? null,
            stadiumBearingDeg: stadiumBearings[g.venue.id],
          })
        : FOOTBALL_LEAGUES.has(league)
          ? buildFootballGameWeatherNarrative({
              slots: footballSlots,
              lat: g.venue.lat,
              lon: g.venue.lon,
              airQuality: f.airQuality ?? null,
              fieldAxis: getFootballFieldAxis(g.venue),
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

    // ── Kickoff-instant snapshot (any league) — feeds the post-game
    // forecast-accuracy write-up. Reuses whichever slots this league already
    // computed above (innings/quarters); ESPN-sourced leagues without
    // per-period slots (MLS) get a single kickoff-instant sample instead. ──
    const kickoffSlot = mlbSlots[0] ?? footballSlots[0]
      ?? (f ? getGameWindowForecast(f.hourly, g.kickoffUTC, f.utcOffsetSeconds, 0)[0] ?? null : null);
    let forecastAccuracyWriteup: string | null = null;
    // Independent of kickoffSlot (unlike the snapshot below): getForecast()'s
    // hourly array is trimmed to "current hour onward" everywhere in the app
    // (see open-meteo.ts), so a past kickoff has already fallen out of it by
    // the time a finished game is checked — kickoffSlot is null for nearly
    // every 'post' game regardless of whether a snapshot exists. Both
    // lookups below go straight to Redis/NWS instead of the forecast object.
    let actualConditionsSummary: string | null = null;
    if (weatherMatters) {
      if (g.state === 'pre' && kickoffSlot) {
        await saveKickoffSnapshot(g.id, {
          tempF: kickoffSlot.tempF,
          windSpeedMph: kickoffSlot.windSpeedMph,
          precipProbability: kickoffSlot.precipProbability,
          description: kickoffSlot.description,
        });
      } else if (g.state === 'post') {
        forecastAccuracyWriteup = await getForecastAccuracyWriteup(g.id, g.venue, g.kickoffUTC);
        if (!forecastAccuracyWriteup) {
          actualConditionsSummary = await getActualConditionsSummary(g.id, g.venue, g.kickoffUTC);
        }
      } else if (g.state === 'in' && !weatherNarrative) {
        // A live game's kickoff has, by definition, already happened — so it
        // hits the exact same trimmed-hourly-array problem as a finished game
        // (see the comment above) once enough of its window has elapsed
        // (extra innings, a late/long game). Only worth the NWS round-trip
        // when weatherNarrative actually came back empty — the common case
        // (early in a game, most of its window still ahead) already has one.
        forecastAccuracyWriteup = await getForecastAccuracyWriteup(g.id, g.venue, g.kickoffUTC);
        if (!forecastAccuracyWriteup) {
          actualConditionsSummary = await getActualConditionsSummary(g.id, g.venue, g.kickoffUTC);
        }
      }
    }

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
      livePeriodClock: g.livePeriodClock,
      forecastAccuracyWriteup,
      actualConditionsSummary,
    };
  }));

  return { games, windowDays, truncated };
}

/** The single source of truth for "what does the Weather column say" — used
 * by both the Weatherboard and any other page (e.g. a venue page's next-game
 * card) that shows one of these games, so they never disagree. */
export function describeGameWeather(g: Pick<EnrichedScheduleGame, 'roofClosed' | 'weatherMatters' | 'weatherNarrative' | 'day' | 'state' | 'forecastAccuracyWriteup' | 'actualConditionsSummary'>): string {
  if (g.roofClosed) return 'Roof closed — weather is not a factor for this game.';
  if (!g.weatherMatters) return 'Indoors';

  // Once a game is final, pre-game forecast language (weatherNarrative, or
  // the day's forecast/precip-chance below) is both stale AND nonsensical
  // (a "% chance of rain" for a game that already happened) — show what
  // actually happened instead: the full forecast-vs-actual write-up when a
  // snapshot exists, or just the actual conditions when it doesn't. Only
  // fall through to forecast language if NWS couldn't resolve either one —
  // and even then, still don't show the stale day-forecast fallback below.
  if (g.state === 'post') {
    return g.forecastAccuracyWriteup ?? g.actualConditionsSummary ?? '—';
  }

  // A live game's own kickoff-to-now window can ALSO have fallen entirely
  // out of the trimmed forecast array (extra innings, a long game nearing
  // its end) — same fix as 'post', just preferring the forward-looking
  // narrative when it's actually available (the common case, early in a
  // game with most of its window still ahead).
  if (g.state === 'in') {
    return g.weatherNarrative ?? g.forecastAccuracyWriteup ?? g.actualConditionsSummary ?? '—';
  }

  // 'pre' — the only state where a forward-looking forecast is honest.
  if (g.weatherNarrative) return g.weatherNarrative;
  if (!g.day) return '—';
  return `${Math.round(g.day.highF)}°/${Math.round(g.day.lowF)}° · ${Math.round(g.day.windSpeedMph)}mph wind · ${g.day.precipProbability}% precip.`;
}
