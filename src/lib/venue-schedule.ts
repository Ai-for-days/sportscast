// Next home game for a venue's team — via ESPN's free, keyless league
// SCOREBOARD endpoint with an explicit date range, filtered down to this
// team's home games. Team-to-ESPN-id mapping comes from team-espn-ids.json
// (see scripts/build-team-logos.mjs).
//
// This originally fetched per TEAM (per-team schedule endpoint, then later
// a per-team scoreboard-range call). Both got ESPN rate-limiting us: real
// production traffic across dozens of teams in the same league meant dozens
// of near-duplicate calls fetching overlapping date ranges within the same
// cache window — confirmed live 2026-08-19, 74 failed fetches from 17 users
// in 15 minutes, all 403 Forbidden. espn-football-schedule.ts (used by
// /nfl-weather) never hit this because it caches one slate per LEAGUE, not
// per team, so this now does the same: one scoreboard fetch serves every
// team in that league for the whole cache TTL.
//
// Bulletproof: any failure resolves to null so the venue page still renders
// with just current-conditions weather.

import { getVenueEspnTeam } from './venue-data';
import { getRedis } from './redis';
import { getNextMlbHomeGame } from './mlb-schedule';
import type { Venue } from './types';

export interface NextHomeGame {
  opponent: string;
  kickoffUTC: string; // ISO 8601
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  broadcast: string;
}

const LEAGUE_CACHE_TTL_SECONDS = 3600; // 1 hour, shared across every team in the league
const FAILURE_BACKOFF_SECONDS = 180; // 3 min — throttles retries during an ESPN outage/rate-limit
const FETCH_TIMEOUT_MS = 8000;

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

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchRangeEvents(leaguePath: string, startDate: Date, days: number): Promise<any[] | null> {
  const end = new Date(startDate.getTime() + days * 86400000);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${yyyymmdd(startDate)}-${yyyymmdd(end)}&limit=1000`;
  const data = await fetchJson(url);
  return data ? (data.events ?? []) : null;
}

// Steady-state window tuned to each league's cadence (small = fast, light
// payload). The wider fallback only fires when the narrow window comes back
// empty — the whole league goes into it together (off-season), so it's one
// extra shared call, not one per team.
function windowsFor(leaguePath: string): number[] {
  if (leaguePath.startsWith('soccer/')) return [70, 140];
  if (leaguePath === 'baseball/mlb') return [30, 210]; // MLB plays near-daily; 210 bridges the Oct-Mar gap
  return [45, 220]; // NFL, NCAA football; 220 bridges the Feb-Sept off-season
}

/** One scoreboard fetch (cached) serves every team in the league. */
export async function getLeagueEvents(leaguePath: string): Promise<any[] | null> {
  const cacheKey = `schedule:league:${leaguePath}`;
  try {
    const raw = await getRedis().get(cacheKey);
    if (raw !== null && raw !== undefined) {
      return (typeof raw === 'string' ? JSON.parse(raw) : raw) as any[];
    }
  } catch {
    /* redis unconfigured or miss — fall through to fetch */
  }

  const now = new Date(Date.now());
  let events: any[] | null = null;
  let anySuccess = false;
  for (const days of windowsFor(leaguePath)) {
    const fetched = await fetchRangeEvents(leaguePath, now, days);
    if (fetched !== null) {
      anySuccess = true;
      events = fetched;
      if (fetched.length > 0) break; // real data — no need for the wider window
    }
  }

  // Cache something either way. A fetch failure (e.g. ESPN rate-limiting us)
  // still gets a short backoff cache — otherwise every single venue-page view
  // retries ESPN with no throttling at all, which is exactly what got us
  // rate-limited in the first place. A real success (even an empty result —
  // genuinely no games in the window) gets the full hour.
  try {
    const ttl = anySuccess ? LEAGUE_CACHE_TTL_SECONDS : FAILURE_BACKOFF_SECONDS;
    await getRedis().set(cacheKey, JSON.stringify(events ?? []), { ex: ttl });
  } catch {
    /* ignore */
  }

  return events;
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
    const broadcast: string = (comp?.broadcasts ?? []).flatMap((b: any) => b?.names ?? []).filter(Boolean).join(', ');
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

  // MLB routes through the MLB Stats API (mlb-schedule.ts) instead of ESPN —
  // see that file's comment for why: ESPN rate-limits our Vercel egress IP,
  // and this different provider isn't affected.
  if (team.leaguePath === 'baseball/mlb' && venue.team) {
    const mlbGame = await getNextMlbHomeGame(venue.team);
    if (!mlbGame) return null;
    return { opponent: mlbGame.opponent, kickoffUTC: mlbGame.kickoffUTC, state: mlbGame.state, statusDetail: mlbGame.statusDetail, broadcast: '' };
  }

  const events = await getLeagueEvents(team.leaguePath);
  if (!events) return null;

  return earliestFutureHomeGame(events, team.teamId, Date.now());
}
