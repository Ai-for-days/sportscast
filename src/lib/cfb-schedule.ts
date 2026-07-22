// College football schedule → venue mapping for the College Football Weather
// Report page.
//
// Source: ESPN's free, public college-football scoreboard API (no key). With no
// `dates` param it returns the CURRENT scoreboard week — which is the right model
// for CFB (a Saturday-centric sport, not a daily one). We map each game's HOME
// team to our venue-data entry (lat/lon + roof) and cache the parsed slate in
// Redis for 30 minutes. Bulletproof: every failure path degrades to an empty
// slate so the page still renders.
//
// `groups=80` restricts to FBS (I-A). ESPN team `displayName`s match our
// venue-data `team` fields (e.g. "Alabama Crimson Tide", "Ohio State Buckeyes").

import { venues } from './venue-data';
import { getRedis } from './redis';
import type { Venue } from './types';

export type CfbGameState = 'pre' | 'in' | 'post';

export interface CfbGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeRank: number | null; // AP/CFP rank; null when unranked
  awayRank: number | null;
  kickoffUTC: string; // ISO 8601
  state: CfbGameState; // pre = scheduled, in = live, post = final
  statusDetail: string; // ESPN short detail, e.g. "Final" / "7:30 PM ET"
  broadcast: string; // TV network(s), may be empty
  neutralSite: boolean;
  venue: Venue | null; // mapped venue-data entry (coords + roof); null if unmapped
  espnVenueName: string; // ESPN's venue name (fallback label)
  espnVenueCity: string; // ESPN's venue city (fallback label)
}

export interface CfbSlate {
  season: number;
  seasonType: number; // 2 = regular, 3 = postseason
  week: number;
  games: CfbGame[];
}

const SLATE_TTL_SECONDS = 1800; // 30 min
const EMPTY_SLATE: CfbSlate = { season: 0, seasonType: 0, week: 0, games: [] };

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function normVenueName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Home-team-name -> venue and venue-name -> venue (built once). The first maps
// normal games by home team; the second recovers neutral-site games (bowls,
// kickoff classics) where the home team's own stadium is the wrong location.
const teamToVenue = new Map<string, Venue>();
const nameToVenue = new Map<string, Venue>();
for (const v of venues) {
  if (v.league === 'ncaa-football') {
    if (v.team) teamToVenue.set(normTeam(v.team), v);
    nameToVenue.set(normVenueName(v.name), v);
  }
}

// ESPN curatedRank uses 99 to mean "unranked".
function toRank(n: unknown): number | null {
  const r = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(r) && r >= 1 && r <= 25 ? r : null;
}

function espnStateToGameState(state: unknown): CfbGameState {
  return state === 'in' ? 'in' : state === 'post' ? 'post' : 'pre';
}

/** The current college-football week's FBS slate. Cached 30 min; never throws. */
export async function getCfbSlate(): Promise<CfbSlate> {
  const cacheKey = 'cfb:slate:current';

  // 1. Cache read (both Upstash shapes per CLAUDE.md).
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw) return (typeof raw === 'string' ? JSON.parse(raw) : raw) as CfbSlate;
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  // 2. Fetch from ESPN (timeout-bounded). No `dates` param = current week.
  let slate: CfbSlate = EMPTY_SLATE;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=400',
      { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data: any = await res.json();
      const games: CfbGame[] = [];
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
    slate = EMPTY_SLATE;
  }

  // 3. Cache write (best-effort). Only cache a non-empty slate so a transient
  //    ESPN failure doesn't pin an empty page for 30 minutes.
  try {
    if (slate.games.length) await getRedis().set(cacheKey, JSON.stringify(slate), { ex: SLATE_TTL_SECONDS });
  } catch {
    /* ignore */
  }

  return slate;
}
