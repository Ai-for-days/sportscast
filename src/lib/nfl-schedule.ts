// NFL schedule for the NFL Weather Report page. Thin wrapper over the shared
// ESPN football fetcher (see espn-football-schedule.ts). No `groups` filter (all
// 32 teams); home teams map to venue-data `league: 'nfl'` stadiums (coords +
// roof). Neutral-site international games (London / Munich / Madrid / Mexico
// City) have no venue-data match, so they degrade to unmapped rather than being
// pinned to the home team's US stadium.

import { getEspnFootballSlate, type FootballGame, type FootballSlate, type FootballGameState } from './espn-football-schedule';

export type NflGameState = FootballGameState;
export type NflGame = FootballGame;
export type NflSlate = FootballSlate;

/** The current NFL week's slate. Cached 30 min; never throws. */
export function getNflSlate(): Promise<NflSlate> {
  return getEspnFootballSlate({
    leaguePath: 'nfl',
    venueLeague: 'nfl',
    cacheKey: 'nfl:slate:current',
  });
}
