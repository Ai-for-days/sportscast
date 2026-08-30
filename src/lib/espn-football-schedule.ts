// Shared ESPN football-schedule fetcher for the weekly weather-report pages
// (/college-football-weather and /nfl-weather). Both consume ESPN's free,
// keyless scoreboard API, which has an identical shape for college football and
// the NFL — so the fetch/parse/venue-map logic lives here once, and each sport
// is a thin config wrapper (cfb-schedule.ts / nfl-schedule.ts).
//
// ESPN's no-`dates` "current week" call is unreliable around a week boundary —
// verified 2026-08-19 (a Wednesday) it returned week 2 with all 16 games
// already "Final" instead of the actual upcoming week 3 slate. So instead we
// request an explicit Tuesday-through-Monday window containing today (the NFL's
// own week cadence), which reliably tracks "now" regardless of ESPN's internal
// week bookkeeping. Each game's HOME team maps to our venue-data entry (lat/lon
// + roof); neutral-site games map by ESPN venue name instead so bowls /
// international games don't get pinned to the home team's own stadium. Cached
// in Redis; every failure degrades to an empty slate.

import { venues } from './venue-data';
import { getRedis } from './redis';
import type { Venue } from './types';

export type FootballGameState = 'pre' | 'in' | 'post';

export interface FootballGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeRank: number | null; // AP/CFP rank (college); null for the NFL / unranked
  awayRank: number | null;
  kickoffUTC: string; // ISO 8601
  homeScore: number | null; // null before kickoff (and if ESPN omits it); a number once the game is live or final
  awayScore: number | null;
  state: FootballGameState; // pre = scheduled, in = live, post = final
  statusDetail: string; // ESPN short detail, e.g. "Final" / "7:30 PM ET"
  broadcast: string; // TV network(s), may be empty
  neutralSite: boolean;
  venue: Venue | null; // mapped venue-data entry (coords + roof); null if unmapped
  espnVenueName: string; // ESPN's venue name (fallback label)
  espnVenueCity: string; // ESPN's venue city (fallback label)
}

export interface FootballSlate {
  season: number;
  seasonType: number; // 2 = regular, 3 = postseason
  week: number;
  games: FootballGame[];
}

export interface EspnFootballConfig {
  /** ESPN league path segment: 'college-football' | 'nfl'. */
  leaguePath: string;
  /** venue-data `league` value to map home teams against: 'ncaa-football' | 'nfl'. */
  venueLeague: string;
  /** Optional ESPN `groups` filter (e.g. '80' = FBS). Omit for the NFL. */
  groups?: string;
  /** Redis cache key for this sport's current-week slate. */
  cacheKey: string;
}

// Same live-score-staleness issue found and fixed in mlb-schedule.ts's
// range cache (2026-08-23): this one blob carries both the (safe to cache
// long) weekly slate AND each game's live state/score, so it needs the
// same short, live-score-appropriate TTL rather than the schedule's own.
const SLATE_TTL_SECONDS = 60;

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function normVenueName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ESPN curatedRank uses 99 to mean "unranked"; the NFL omits it entirely.
function toRank(n: unknown): number | null {
  const r = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(r) && r >= 1 && r <= 25 ? r : null;
}

/** ESPN sends a competitor's score as a string ("12"), and omits it entirely before kickoff. */
function toScore(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function espnStateToGameState(state: unknown): FootballGameState {
  return state === 'in' ? 'in' : state === 'post' ? 'post' : 'pre';
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** The Tuesday-through-Monday UTC window (the NFL's own week cadence) containing `now`. */
function currentWeekWindow(now: Date): { start: string; end: string } {
  const dow = now.getUTCDay(); // Sun=0 .. Sat=6
  const daysSinceTuesday = (dow - 2 + 7) % 7;
  const start = new Date(now.getTime() - daysSinceTuesday * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: yyyymmdd(start), end: yyyymmdd(end) };
}

/** Build the home-team and venue-name lookup maps for one venue-data league. */
function buildVenueMaps(venueLeague: string): { teamToVenue: Map<string, Venue>; nameToVenue: Map<string, Venue> } {
  const teamToVenue = new Map<string, Venue>();
  const nameToVenue = new Map<string, Venue>();
  for (const v of venues) {
    if (v.league === venueLeague) {
      if (v.team) teamToVenue.set(normTeam(v.team), v);
      nameToVenue.set(normVenueName(v.name), v);
    }
  }
  return { teamToVenue, nameToVenue };
}

/**
 * One scoreboard call. Returns the parsed JSON, or null when the request
 * failed or the window held no events — either way with a line in the log,
 * because every failure here used to be swallowed silently and surfaced only
 * as a page that claimed no games were scheduled.
 */
async function fetchScoreboard(cfg: EspnFootballConfig, dates: string | null): Promise<any | null> {
  const params = new URLSearchParams({ limit: '400' });
  if (dates) params.set('dates', dates);
  if (cfg.groups) params.set('groups', cfg.groups);
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/${cfg.leaguePath}/scoreboard?${params.toString()}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[espn-football-schedule] ESPN ${res.status} ${res.statusText}: ${url}`);
      return null;
    }
    const data: any = await res.json();
    const count = data?.events?.length ?? 0;
    if (!count) {
      console.error(`[espn-football-schedule] ESPN returned 0 events: ${url}`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[espn-football-schedule] ESPN fetch threw: ${url}`, err);
    return null;
  }
}

/** The current week's slate for one ESPN football league. Cached 30 min; never throws. */
export async function getEspnFootballSlate(cfg: EspnFootballConfig): Promise<FootballSlate> {
  const emptySlate: FootballSlate = { season: 0, seasonType: 0, week: 0, games: [] };

  // 1. Cache read (both Upstash shapes per CLAUDE.md).
  try {
    const raw = await getRedis().get(cfg.cacheKey);
    if (raw) return (typeof raw === 'string' ? JSON.parse(raw) : raw) as FootballSlate;
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  // 2. Fetch from ESPN (timeout-bounded), pinned to an explicit date window
  //    (see comment above) rather than trusting ESPN's own "current week".
  const { teamToVenue, nameToVenue } = buildVenueMaps(cfg.venueLeague);
  let slate: FootballSlate = emptySlate;
  try {
    const { start, end } = currentWeekWindow(new Date());
    // The dated window is the primary call (it tracks "now" across a week
    // boundary, which ESPN's self-reported current week does not). Falling
    // back to the bare current-week call when it yields nothing is deliberate:
    // an empty football page in the middle of a live Saturday slate is a worse
    // failure than a slate that is a few hours stale at a week boundary, which
    // is the only thing the dated window was added to fix.
    const res = await fetchScoreboard(cfg, `${start}-${end}`) ?? await fetchScoreboard(cfg, null);
    if (res) {
      const data: any = res;
      const games: FootballGame[] = [];
      for (const ev of data?.events ?? []) {
        // Per-event, so one oddly-shaped game cannot empty the whole slate.
        // Previously anything that threw in here landed in the outer catch and
        // took all of that week's games down with it, silently.
        try {
        const comp = ev?.competitions?.[0];
        if (!comp) continue;
        const competitors = comp?.competitors ?? [];
        const home = competitors.find((c: any) => c?.homeAway === 'home');
        const away = competitors.find((c: any) => c?.homeAway === 'away');
        const homeTeam = home?.team?.displayName ?? '';
        const awayTeam = away?.team?.displayName ?? '';
        if (!homeTeam || !awayTeam) continue;

        const neutralSite = !!comp?.neutralSite;
        const espnVenueName = comp?.venue?.fullName ?? '';
        const venue = neutralSite
          ? nameToVenue.get(normVenueName(espnVenueName)) ?? null
          : teamToVenue.get(normTeam(homeTeam)) ?? null;

        const broadcast: string = [comp?.broadcasts?.[0]?.names ?? []].flat().join(', ');
        const state = espnStateToGameState(ev?.status?.type?.state);

        games.push({
          id: String(ev?.id ?? ''),
          homeTeam,
          awayTeam,
          homeRank: toRank(home?.curatedRank?.current),
          awayRank: toRank(away?.curatedRank?.current),
          kickoffUTC: ev?.date ?? comp?.date ?? '',
          // Only surface a score once the game has actually started: ESPN
          // reports 0-0 for every scheduled game, and "0 - 0" next to a
          // kickoff time reads as a result rather than an absence.
          homeScore: state === 'pre' ? null : toScore(home?.score),
          awayScore: state === 'pre' ? null : toScore(away?.score),
          state,
          statusDetail: ev?.status?.type?.shortDetail ?? ev?.status?.type?.description ?? '',
          broadcast,
          neutralSite,
          venue,
          espnVenueName,
          espnVenueCity: comp?.venue?.address?.city ?? '',
        });
        } catch (err) {
          console.error(`[espn-football-schedule] skipped event ${ev?.id}`, err);
        }
      }
      // The date-range query doesn't return a top-level `season` block (unlike
      // the old no-dates call), so fall back to the first event's own season info.
      const firstEventSeason = data?.events?.[0]?.season;
      slate = {
        season: Number(data?.season?.year ?? firstEventSeason?.year) || 0,
        seasonType: Number(data?.season?.type ?? firstEventSeason?.type) || 0,
        week: Number(data?.week?.number) || 0,
        games,
      };
    }
  } catch (err) {
    console.error(`[espn-football-schedule] ${cfg.leaguePath}: parse failed`, err);
    slate = emptySlate;
  }
  if (!slate.games.length) {
    console.error(`[espn-football-schedule] ${cfg.leaguePath}: empty slate — page will render its no-games state`);
  }

  // 3. Cache write (best-effort). Only cache a non-empty slate so a transient
  //    ESPN failure doesn't pin an empty page for 30 minutes.
  try {
    if (slate.games.length) await getRedis().set(cfg.cacheKey, JSON.stringify(slate), { ex: SLATE_TTL_SECONDS });
  } catch {
    /* ignore */
  }

  return slate;
}
