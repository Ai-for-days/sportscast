// ── Admin Wager Schedule — combined all-sports schedule for wager creation ──
//
// Per Derek (2026-08-23): a Weatherboard-style schedule, admin-only, that
// combines every tracked league into one list for a given date (with a
// calendar to look ahead) and adds a "create a wager" action per game.
// Reuses getScheduleGames() (the exact same odds/weather/rotation pipeline
// the public Weatherboard uses) so this can never disagree with it — it's
// a different VIEW of the same data, not a second source of truth.
//
// One row per TEAM, not per game (per Derek, follow-up): the away team's
// row shows the forecast at ITS OWN home venue, not the game's actual
// location — useful for cross-city comparisons directly off this schedule.
// The home team's forecast is free (getScheduleGames already computes it
// for the game venue); the away team's home-venue forecast needs its own
// fetch, deduped across the whole day's slate the same way the schedule
// pipeline dedupes its own venue fetches.

import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';
import { getForecast } from './weather-queries';
import type { Venue, ForecastResponse, DailyForecast } from './types';

export type WagerScheduleLeague = SiteLeague;

export interface WagerScheduleRow {
  id: string;
  gameId: string;
  side: 'away' | 'home';
  league: WagerScheduleLeague;
  leagueLabel: string;
  kickoffUTC: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  team: string;
  opponent: string;
  rotation: number | null;
  score: number | null;
  /** MLB only — "Name (R)"/"Name (L)", null for ESPN-sourced leagues or when not yet announced. */
  pitcher: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueState: string | null;
  lat: number | null;
  lon: number | null;
  /** Wager on Weather's daily high/low forecast at THIS TEAM's own home
   * venue for the target date — null when there's no venue on file (rare
   * ESPN edge cases) or the forecast doesn't reach this date yet. */
  highF: number | null;
  lowF: number | null;
}

function pitcherLabel(p: { name: string; hand: 'R' | 'L' | null } | null): string | null {
  if (!p) return null;
  return p.hand ? `${p.name} (${p.hand})` : p.name;
}

export const WAGER_SCHEDULE_LEAGUE_LABELS: Record<SiteLeague, string> = {
  mlb: 'MLB',
  nfl: 'NFL',
  'ncaa-football': 'NCAA Football',
  mls: 'MLS & Soccer',
};

const LEAGUES: SiteLeague[] = ['mlb', 'nfl', 'ncaa-football', 'mls'];

function localDateStr(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { timeZone: tz });
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

/** Every tracked game across all 4 leagues on one ET calendar date, one row
 * per team (away first, then home), soonest first. `windowDays` should
 * comfortably cover `dateStr` (see the page for how it's sized). */
export async function getCombinedScheduleForDate(dateStr: string, windowDays: number): Promise<WagerScheduleRow[]> {
  const ET = 'America/New_York';
  const perLeague = await Promise.all(
    LEAGUES.map((league) =>
      getScheduleGames(league, windowDays).catch(() => ({ games: [] as EnrichedScheduleGame[], windowDays, truncated: false })),
    ),
  );

  const gamesForDate: { league: SiteLeague; g: EnrichedScheduleGame }[] = [];
  perLeague.forEach((result, i) => {
    const league = LEAGUES[i];
    for (const g of result.games) {
      if (localDateStr(g.kickoffUTC, ET) !== dateStr) continue;
      gamesForDate.push({ league, g });
    }
  });

  // Away-venue forecasts aren't computed by getScheduleGames (it only
  // fetches the game's own host venue) — fetch each unique away venue once,
  // same dedup-by-id pattern the schedule pipeline itself uses.
  const awayVenuesNeeded = new Map<string, Venue>();
  for (const { g } of gamesForDate) {
    if (g.awayVenue && g.awayVenue.id !== g.venue.id && !awayVenuesNeeded.has(g.awayVenue.id)) {
      awayVenuesNeeded.set(g.awayVenue.id, g.awayVenue);
    }
  }
  const awayForecastEntries = await Promise.all(
    [...awayVenuesNeeded.values()].map(async (v) => {
      try {
        return [v.id, await getForecast(v.lat, v.lon, Math.min(16, windowDays + 1))] as const;
      } catch {
        return [v.id, null] as const;
      }
    }),
  );
  const awayForecasts = new Map(awayForecastEntries);

  const rows: WagerScheduleRow[] = [];
  for (const { league, g } of gamesForDate) {
    const leagueLabel = WAGER_SCHEDULE_LEAGUE_LABELS[league];

    // Away team's row — their OWN home venue, not the game's location.
    const awayVenue = g.awayVenue;
    const awayIsHostVenue = awayVenue && awayVenue.id === g.venue.id; // shouldn't happen (that'd make them the home team), defensive only
    const awayDaily = !awayVenue
      ? null
      : awayIsHostVenue
        ? g.day
        : (() => {
            const f = awayForecasts.get(awayVenue.id);
            return f ? findDailyForDate(f, g.kickoffUTC) : null;
          })();
    rows.push({
      id: `${league}-${g.id}-away`,
      gameId: g.id,
      side: 'away',
      league,
      leagueLabel,
      kickoffUTC: g.kickoffUTC,
      state: g.state,
      statusDetail: g.statusDetail,
      team: g.awayTeam,
      opponent: g.homeTeam,
      rotation: g.lines?.awayRotation ?? null,
      score: g.state !== 'pre' ? g.awayScore : null,
      pitcher: pitcherLabel(g.awayPitcher),
      venueName: awayVenue?.name ?? null,
      venueCity: awayVenue?.city ?? null,
      venueState: awayVenue?.state ?? null,
      lat: awayVenue?.lat ?? null,
      lon: awayVenue?.lon ?? null,
      highF: awayDaily?.highF ?? null,
      lowF: awayDaily?.lowF ?? null,
    });

    // Home team's row — the game's own venue, already computed for free.
    rows.push({
      id: `${league}-${g.id}-home`,
      gameId: g.id,
      side: 'home',
      league,
      leagueLabel,
      kickoffUTC: g.kickoffUTC,
      state: g.state,
      statusDetail: g.statusDetail,
      team: g.homeTeam,
      opponent: g.awayTeam,
      rotation: g.lines?.homeRotation ?? null,
      score: g.state !== 'pre' ? g.homeScore : null,
      pitcher: pitcherLabel(g.homePitcher),
      venueName: g.venue.name,
      venueCity: g.venue.city,
      venueState: g.venue.state,
      lat: g.venue.lat,
      lon: g.venue.lon,
      highF: g.day?.highF ?? null,
      lowF: g.day?.lowF ?? null,
    });
  }

  rows.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC) || (a.side === b.side ? 0 : a.side === 'away' ? -1 : 1));
  return rows;
}
