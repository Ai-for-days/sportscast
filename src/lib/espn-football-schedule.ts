// Shared ESPN football-schedule fetcher for the weekly weather-report pages
// (/college-football-weather and /nfl-weather). Both consume ESPN's free,
// keyless scoreboard API, which has an identical shape for college football and
// the NFL — so the fetch/parse/venue-map logic lives here once, and each sport
// is a thin config wrapper (cfb-schedule.ts / nfl-schedule.ts).
//
// With no `dates` param ESPN returns the CURRENT scoreboard week — the right
// model for these Saturday/Sunday-centric sports. Each game's HOME team maps to
// our venue-data entry (lat/lon + roof); neutral-site games map by ESPN venue
// name instead so bowls / international games don't get pinned to the home
// team's own stadium. Cached in Redis; every failure degrades to an empty slate.

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

const SLATE_TTL_SECONDS = 1800; // 30 min

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

function espnStateToGameState(state: unknown): FootballGameState {
  return state === 'in' ? 'in' : state === 'post' ? 'post' : 'pre';
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

  // 2. Fetch from ESPN (timeout-bounded). No `dates` param = current week.
  const { teamToVenue, nameToVenue } = buildVenueMaps(cfg.venueLeague);
  let slate: FootballSlate = emptySlate;
  try {
    const params = new URLSearchParams({ limit: '400' });
    if (cfg.groups) params.set('groups', cfg.groups);
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/${cfg.leaguePath}/scoreboard?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } });
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      const games: FootballGame[] = [];
      for (const ev of data?.events ?? []) {
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

        const broadcast: string = (comp?.broadcasts?.[0]?.names ?? []).join(', ');

        games.push({
          id: String(ev?.id ?? ''),
          homeTeam,
          awayTeam,
          homeRank: toRank(home?.curatedRank?.current),
          awayRank: toRank(away?.curatedRank?.current),
          kickoffUTC: ev?.date ?? comp?.date ?? '',
          state: espnStateToGameState(ev?.status?.type?.state),
          statusDetail: ev?.status?.type?.shortDetail ?? ev?.status?.type?.description ?? '',
          broadcast,
          neutralSite,
          venue,
          espnVenueName,
          espnVenueCity: comp?.venue?.address?.city ?? '',
        });
      }
      slate = {
        season: Number(data?.season?.year) || 0,
        seasonType: Number(data?.season?.type) || 0,
        week: Number(data?.week?.number) || 0,
        games,
      };
    }
  } catch {
    slate = emptySlate;
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
