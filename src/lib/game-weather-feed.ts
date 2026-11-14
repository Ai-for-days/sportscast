// ── Game weather feed: /api/feeds/game-weather ─────────────────────────────
//
// Added 2026-11-14 under Professor ruling WOW-002 (W1-feed). A small public,
// read-only JSON feed of the weather for each upcoming game, built for the
// rotowire-discord injury alerts (C:\rotowire-discord), whose weather line
// asked for "kickoff write-up, WES and impact ratings, no quarter-by-quarter
// numbers".
//
// What it may contain is fixed by the ruling, not by what is convenient:
//   - only games that have not started (state 'pre');
//   - only fields already shown on the public boards (/weatherboard/*,
//     /college-football-weather, venue pages), plus forecastGeneratedAt;
//   - NO odds, lines, rotation numbers, scores, hourly arrays or per-quarter /
//     per-inning data. tests/game-weather-feed.test.ts walks every key of a
//     response against a frozen allowlist.
//
// Never invent data (CLAUDE.md rule; PROFESSOR-PROJECT rule 5). A game whose
// forecast is synthetic, missing, more than FORECAST_MAX_AGE_HOURS old, or
// does not reach kickoff day goes to `unavailable[]` with a reason and no
// weather fields at all.
//
// `forecastGeneratedAt` is when WagerOnWeather assembled the forecast
// (ForecastResponse.generatedAt), NOT when a provider issued its model run.

import { getScheduleGames, describeGameWeather, type EnrichedScheduleGame, type ScheduleResult, type SiteLeague } from './league-schedule';
import { footballWeatherNote, type ImpactTone } from './football-weather-report';
import type { FootballGame } from './espn-football-schedule';
import { getWesBand } from './wes-scale';
import { getVenueHref, getVenueSlug } from './venue-slug';
import { recordSourceSuccess, recordSourceFailure } from './data-source-health';

export const FEED_VERSION = '1';
export const FEED_LEAGUES: readonly SiteLeague[] = ['ncaa-football', 'nfl', 'mlb', 'mls'];
export const FEED_WINDOW_DAYS = 7;
export const FORECAST_MAX_AGE_HOURS = 3;
export const WRITEUP_MAX_CHARS = 240;
const SITE_ORIGIN = 'https://wageronweather.com';
const FOOTBALL: ReadonlySet<SiteLeague> = new Set<SiteLeague>(['ncaa-football', 'nfl']);

export type UnavailableReason = 'synthetic' | 'no-forecast' | 'stale' | 'out-of-horizon';

export interface FeedGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  kickoffUTC: string;
  /** ESPN has not set the kickoff time (WOW-006). kickoffUTC is then ESPN's
   *  00:00-ET placeholder; `kickoff` and `wes` are null and `day` is the
   *  forecast for the game's ET date. */
  kickoffTimeTBD: boolean;
  neutralSite: boolean;
  venue: { name: string; city: string; state: string; slug: string | null; url: string };
  indoor: boolean;
  roofUncertain: boolean;
  /** Time WagerOnWeather assembled this forecast, not a provider's issue time. */
  forecastGeneratedAt: string | null;
  forecastSource: string | null;
  day: { highF: number; lowF: number; sky: string } | null;
  kickoff: { tempF: number; windMph: number; gustMph: number; rainChancePct: number } | null;
  wes: { score: number; band: string; basis: 'kickoff window' } | null;
  impact: { label: ImpactTone; note: string; basis: 'game-day daily forecast' } | null;
  writeup: string;
}

export interface FeedUnavailable {
  id: string;
  awayTeam: string;
  homeTeam: string;
  kickoffUTC: string;
  reason: UnavailableReason;
}

export interface GameWeatherFeed {
  version: string;
  league: SiteLeague;
  generatedAt: string;
  truncated: boolean;
  forecastMaxAgeHours: number;
  games: FeedGame[];
  unavailable: FeedUnavailable[];
}

/** The football impact note, fed from the enriched game (no second schedule fetch).
 *  footballWeatherNote reads only `venue.type` from its game argument. */
export function impactFor(g: Pick<EnrichedScheduleGame, 'venue' | 'roofClosed' | 'day'>): FeedGame['impact'] {
  const venue = g.roofClosed ? { ...g.venue, type: 'indoor' as const } : g.venue;
  const note = footballWeatherNote({ venue } as unknown as FootballGame, g.roofClosed ? null : g.day);
  return { label: note.tone, note: note.text, basis: 'game-day daily forecast' };
}

/** One sentence, at most WRITEUP_MAX_CHARS characters. */
export function oneSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // A sentence ends at . ! or ? followed by a space and a capital letter, or by
  // the end of the text, so "2.5 in" and "a.m." mid-sentence do not split it.
  const m = t.match(/^(.+?[.!?])(?=\s+[A-Z]|$)/);
  let s = m ? m[1] : t;
  if (s.length > WRITEUP_MAX_CHARS) {
    const cut = s.slice(0, WRITEUP_MAX_CHARS - 1);
    const sp = cut.lastIndexOf(' ');
    s = `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,;:—-]+$/, '')}…`;
  }
  return s;
}

function isIndoor(g: EnrichedScheduleGame): boolean {
  return g.venue.type === 'indoor' || g.roofClosed;
}

/** Why a pre-game outdoor game cannot be served, or null when it can. */
export function unavailableReason(g: EnrichedScheduleGame, nowMs: number): UnavailableReason | null {
  if (g.forecastSynthetic) return 'synthetic';
  if (!g.forecastGeneratedAt) return 'no-forecast';
  const genMs = Date.parse(g.forecastGeneratedAt);
  if (!Number.isFinite(genMs) || nowMs - genMs > FORECAST_MAX_AGE_HOURS * 3_600_000) return 'stale';
  if (!g.day) return 'out-of-horizon';
  return null;
}

function venueOf(g: EnrichedScheduleGame): FeedGame['venue'] {
  return {
    name: g.venue.name,
    city: g.venue.city,
    state: g.venue.state,
    slug: getVenueSlug(g.venue),
    url: `${SITE_ORIGIN}${getVenueHref(g.venue)}`,
  };
}

export function buildGameWeatherFeed(league: SiteLeague, result: ScheduleResult, nowMs: number): GameWeatherFeed {
  const games: FeedGame[] = [];
  const unavailable: FeedUnavailable[] = [];
  const football = FOOTBALL.has(league);

  for (const g of result.games) {
    if (g.state !== 'pre') continue;
    const base = { id: g.id, awayTeam: g.awayTeam, homeTeam: g.homeTeam, kickoffUTC: g.kickoffUTC };

    if (isIndoor(g)) {
      games.push({
        ...base,
        kickoffTimeTBD: g.kickoffTimeTBD,
        neutralSite: g.neutralSite,
        venue: venueOf(g),
        indoor: true,
        roofUncertain: false,
        forecastGeneratedAt: null,
        forecastSource: null,
        day: null,
        kickoff: null,
        wes: null,
        impact: football ? impactFor({ venue: g.venue, roofClosed: true, day: null }) : null,
        writeup: oneSentence(describeGameWeather(g)),
      });
      continue;
    }

    const reason = unavailableReason(g, nowMs);
    if (reason) {
      unavailable.push({ ...base, reason });
      continue;
    }

    const day = g.day!;
    const k = g.kickoffWeather;
    const wesScore = g.wes ? Math.round(g.wes.wesFinal) : null;
    games.push({
      ...base,
      kickoffTimeTBD: g.kickoffTimeTBD,
      neutralSite: g.neutralSite,
      venue: venueOf(g),
      indoor: false,
      roofUncertain: g.roofUncertain,
      forecastGeneratedAt: g.forecastGeneratedAt,
      forecastSource: g.forecastSource,
      day: { highF: Math.round(day.highF), lowF: Math.round(day.lowF), sky: day.description },
      kickoff: k
        ? { tempF: Math.round(k.tempF), windMph: Math.round(k.windSpeedMph), gustMph: Math.round(k.windGustMph), rainChancePct: Math.round(k.precipProbability) }
        : null,
      wes: g.wes && wesScore !== null ? { score: wesScore, band: getWesBand(g.wes.wesFinal).label, basis: 'kickoff window' } : null,
      impact: football ? impactFor(g) : null,
      // roofUncertain is its own field; the board's roof caveat sentence would
      // otherwise be the whole one-sentence write-up.
      writeup: oneSentence(describeGameWeather({ ...g, roofUncertain: false })),
    });
  }

  return {
    version: FEED_VERSION,
    league,
    generatedAt: new Date(nowMs).toISOString(),
    truncated: result.truncated,
    forecastMaxAgeHours: FORECAST_MAX_AGE_HOURS,
    games,
    unavailable,
  };
}

export interface FeedDeps {
  getScheduleGames: (league: SiteLeague, windowDays: number, teamFilter?: string, opts?: { weatherOnly?: boolean }) => Promise<ScheduleResult>;
  recordSourceSuccess: (source: 'game-weather-feed') => Promise<void>;
  recordSourceFailure: (source: 'game-weather-feed', error: string, severity?: 'critical' | 'warning') => Promise<void>;
  now: () => number;
}

const defaultDeps: FeedDeps = {
  getScheduleGames: (league, windowDays, teamFilter, opts) => getScheduleGames(league, windowDays, teamFilter, opts),
  recordSourceSuccess,
  recordSourceFailure,
  now: () => Date.now(),
};

const OK_CACHE = 'public, s-maxage=600, stale-while-revalidate=300';

function json(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });
}

/** The whole request: parameter checks, build, health record, cache headers. */
export async function handleGameWeatherFeedRequest(url: URL, deps: FeedDeps = defaultDeps): Promise<Response> {
  const keys = [...url.searchParams.keys()];
  const league = url.searchParams.get('league');
  if (keys.some((k) => k !== 'league') || url.searchParams.getAll('league').length !== 1) {
    return json({ error: 'The only parameter is league.' }, 400, 'no-store');
  }
  if (!league || !(FEED_LEAGUES as readonly string[]).includes(league)) {
    return json({ error: `league must be one of: ${FEED_LEAGUES.join(', ')}` }, 400, 'no-store');
  }
  try {
    const result = await deps.getScheduleGames(league as SiteLeague, FEED_WINDOW_DAYS, undefined, { weatherOnly: true });
    const feed = buildGameWeatherFeed(league as SiteLeague, result, deps.now());
    const outdoorServed = feed.games.filter((g) => !g.indoor).length;
    const outdoorTotal = outdoorServed + feed.unavailable.length;
    if (outdoorServed > 0) {
      await deps.recordSourceSuccess('game-weather-feed').catch(() => {});
    } else if (outdoorTotal > 0) {
      await deps
        .recordSourceFailure('game-weather-feed', `${league}: all ${outdoorTotal} outdoor games unavailable`, 'warning')
        .catch(() => {});
    }
    return json(feed, 200, OK_CACHE);
  } catch (e) {
    await deps.recordSourceFailure('game-weather-feed', `${league}: ${e instanceof Error ? e.message : String(e)}`, 'warning').catch(() => {});
    return json({ error: 'Game weather feed is unavailable right now.' }, 500, 'no-store');
  }
}
