// Next home game for a venue's team — via ESPN's free, keyless per-team
// schedule endpoint (site.api.espn.com/.../teams/{id}/schedule). Team-to-ESPN-id
// mapping comes from team-espn-ids.json (see scripts/build-team-logos.mjs).
// Bulletproof: any failure resolves to null so the venue page still renders
// with just current-conditions weather. Cached in Redis 1 hour — schedules
// barely change intra-day, and "next" home game only advances once a game
// is actually played.

import { getVenueEspnTeam } from './venue-data';
import { getRedis } from './redis';
import type { Venue } from './types';

export interface NextHomeGame {
  opponent: string;
  kickoffUTC: string; // ISO 8601
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  broadcast: string;
}

const CACHE_TTL_SECONDS = 3600; // 1 hour
const FETCH_TIMEOUT_MS = 8000;
// 1 = preseason, 2 = regular season, 3 = postseason.
const SEASON_TYPES = [2, 1, 3];

async function fetchJson(url: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'WagerOnWeather/1.0' } });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[venue-schedule] ESPN fetch ${res.status} ${res.statusText}: ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[venue-schedule] ESPN fetch threw: ${url}`, err);
    return null;
  }
}

async function fetchTeamScheduleEvents(leaguePath: string, teamId: string, season: number, seasonType: number): Promise<any[] | null> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams/${teamId}/schedule?season=${season}&seasontype=${seasonType}`;
  const data = await fetchJson(url);
  return data ? (data.events ?? []) : null;
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// MLS/NWSL's per-team schedule endpoint only returns a trailing window of
// already-played games (no future fixtures) — unlike MLB/NFL/NCAA football,
// which return the full season. The league SCOREBOARD with a date range does
// carry future fixtures, so soccer leagues use that instead, filtered down to
// this team's home games.
async function fetchSoccerRangeEvents(leaguePath: string, startDate: Date, days: number): Promise<any[] | null> {
  const end = new Date(startDate.getTime() + days * 86400000);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${yyyymmdd(startDate)}-${yyyymmdd(end)}&limit=1000`;
  const data = await fetchJson(url);
  return data ? (data.events ?? []) : null;
}

function earliestFutureHomeGame(events: any[], teamId: string, nowMs: number): NextHomeGame | null {
  let best: { ms: number; game: NextHomeGame } | null = null;
  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c: any) => c?.homeAway === 'home');
    const away = competitors.find((c: any) => c?.homeAway === 'away');
    if (String(home?.team?.id ?? '') !== teamId) continue; // only this team's home games
    const ms = Date.parse(ev?.date ?? comp?.date ?? '');
    if (!Number.isFinite(ms) || ms < nowMs) continue;
    if (best && ms >= best.ms) continue;
    // Broadcast shape differs between the per-team schedule endpoint
    // ({ media: { shortName } }) and the league scoreboard endpoint ({ names: [...] }).
    const broadcast: string = (comp?.broadcasts ?? [])
      .flatMap((b: any) => (Array.isArray(b?.names) ? b.names : [b?.media?.shortName]))
      .filter(Boolean)
      .join(', ');
    best = {
      ms,
      game: {
        opponent: away?.team?.displayName ?? '',
        kickoffUTC: ev?.date ?? comp?.date ?? '',
        state: (comp?.status?.type?.state === 'in' || comp?.status?.type?.state === 'post') ? comp.status.type.state : 'pre',
        statusDetail: comp?.status?.type?.shortDetail ?? comp?.status?.type?.description ?? '',
        broadcast,
      },
    };
  }
  return best?.game ?? null;
}

/** The soonest upcoming home game for this venue's team, or null (no team, no game found, or fetch failure). */
export async function getNextHomeGame(venue: Venue): Promise<NextHomeGame | null> {
  const team = getVenueEspnTeam(venue.id);
  if (!team) return null;

  // Cache stores { game } rather than a bare nullable value, so a cached
  // "no upcoming game found" result is distinguishable from a cache miss
  // (Upstash returns values already-deserialized, so a bare cached `null`
  // would be indistinguishable from "key not set" — see CLAUDE.md).
  const cacheKey = `schedule:next-home:${venue.id}`;
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw !== null && raw !== undefined) {
      const cached = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { game: NextHomeGame | null };
      return cached.game;
    }
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  const now = new Date(Date.now());
  const nowMs = now.getTime();

  let anySuccess = false;
  let result: NextHomeGame | null = null;

  if (team.leaguePath.startsWith('soccer/')) {
    // Two widening windows (10 weeks, then 20) so a short pause in the
    // schedule (international break, playoff gap) doesn't read as "no game".
    for (const days of [70, 140]) {
      const events = await fetchSoccerRangeEvents(team.leaguePath, now, days);
      if (events !== null) anySuccess = true;
      const found = events ? earliestFutureHomeGame(events, team.teamId, nowMs) : null;
      if (found) {
        result = found;
        break;
      }
    }
  } else {
    const currentYear = now.getUTCFullYear();
    for (const season of [currentYear, currentYear + 1]) {
      const batches = await Promise.all(SEASON_TYPES.map((st) => fetchTeamScheduleEvents(team.leaguePath, team.teamId, season, st)));
      const events = batches.filter((b): b is any[] => b !== null).flat();
      if (batches.some((b) => b !== null)) anySuccess = true;
      const found = earliestFutureHomeGame(events, team.teamId, nowMs);
      if (found) {
        result = found;
        break;
      }
    }
  }

  if (anySuccess) {
    try {
      await getRedis().set(cacheKey, JSON.stringify({ game: result }), { ex: CACHE_TTL_SECONDS });
    } catch {
      /* ignore */
    }
  }

  return result;
}
