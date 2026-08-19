// Next home game for a venue's team — via ESPN's free, keyless league
// SCOREBOARD endpoint with an explicit date range, filtered down to this
// team's home games. Team-to-ESPN-id mapping comes from team-espn-ids.json
// (see scripts/build-team-logos.mjs).
//
// This originally used ESPN's per-team schedule endpoint
// (/teams/{id}/schedule), which worked fine testing locally but returned
// 403 Forbidden for every request from Vercel's production IP — confirmed
// live 2026-08-19 via runtime logs. The league SCOREBOARD endpoint
// (/scoreboard?dates=...) is unaffected (it's what /nfl-weather already
// uses successfully in production via espn-football-schedule.ts), so
// schedule lookups route through it exclusively now.
//
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

  // Two widening windows so a short pause in the schedule (international
  // break for soccer, the multi-month off-season for the others) doesn't
  // read as "no game" — 220 days safely bridges even the NFL's Feb-Sept gap.
  const windows = team.leaguePath.startsWith('soccer/') ? [70, 140] : [60, 220];
  for (const days of windows) {
    const events = await fetchRangeEvents(team.leaguePath, now, days);
    if (events !== null) anySuccess = true;
    const found = events ? earliestFutureHomeGame(events, team.teamId, nowMs) : null;
    if (found) {
      result = found;
      break;
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
