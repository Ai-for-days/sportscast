// ── Admin Wager Schedule — combined all-sports schedule for wager creation ──
//
// Per Derek (2026-08-23): a Weatherboard-style schedule, admin-only, that
// combines every tracked league into one list for a given date (with a
// calendar to look ahead) and adds a "create a wager" action per game.
// Reuses getScheduleGames() (the exact same odds/weather/rotation pipeline
// the public Weatherboard uses) so this can never disagree with it — it's
// a different VIEW of the same data, not a second source of truth.

import { getScheduleGames, type SiteLeague, type EnrichedScheduleGame } from './league-schedule';

export type WagerScheduleLeague = SiteLeague;

export interface WagerScheduleRow {
  id: string;
  league: WagerScheduleLeague;
  leagueLabel: string;
  kickoffUTC: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  awayTeam: string;
  homeTeam: string;
  awayRotation: number | null;
  homeRotation: number | null;
  venueName: string;
  venueCity: string;
  venueState: string;
  lat: number;
  lon: number;
  /** Wager on Weather's daily high/low forecast at the game's venue — null when the forecast doesn't reach this date yet. */
  highF: number | null;
  lowF: number | null;
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

/** Every tracked game across all 4 leagues on one ET calendar date, soonest first. `windowDays` should comfortably cover `dateStr` (see the page for how it's sized). */
export async function getCombinedScheduleForDate(dateStr: string, windowDays: number): Promise<WagerScheduleRow[]> {
  const ET = 'America/New_York';
  const perLeague = await Promise.all(
    LEAGUES.map((league) =>
      getScheduleGames(league, windowDays).catch(() => ({ games: [] as EnrichedScheduleGame[], windowDays, truncated: false })),
    ),
  );

  const rows: WagerScheduleRow[] = [];
  perLeague.forEach((result, i) => {
    const league = LEAGUES[i];
    for (const g of result.games) {
      if (localDateStr(g.kickoffUTC, ET) !== dateStr) continue;
      rows.push({
        id: `${league}-${g.id}`,
        league,
        leagueLabel: WAGER_SCHEDULE_LEAGUE_LABELS[league],
        kickoffUTC: g.kickoffUTC,
        state: g.state,
        statusDetail: g.statusDetail,
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        awayRotation: g.lines?.awayRotation ?? null,
        homeRotation: g.lines?.homeRotation ?? null,
        venueName: g.venue.name,
        venueCity: g.venue.city,
        venueState: g.venue.state,
        lat: g.venue.lat,
        lon: g.venue.lon,
        highF: g.day?.highF ?? null,
        lowF: g.day?.lowF ?? null,
      });
    }
  });

  rows.sort((a, b) => Date.parse(a.kickoffUTC) - Date.parse(b.kickoffUTC));
  return rows;
}
