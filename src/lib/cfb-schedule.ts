// College football schedule for the College Football Weather Report page.
// Thin wrapper over the shared ESPN football fetcher (see
// espn-football-schedule.ts). `groups=80` restricts to FBS (I-A); home teams
// map to venue-data `league: 'ncaa-football'` stadiums (coords + roof).

import { getEspnFootballSlate, type FootballGame, type FootballSlate, type FootballGameState } from './espn-football-schedule';

export type CfbGameState = FootballGameState;
export type CfbGame = FootballGame;
export type CfbSlate = FootballSlate;

/** The current college-football week's FBS slate. Cached 30 min; never throws. */
export function getCfbSlate(): Promise<CfbSlate> {
  return getEspnFootballSlate({
    leaguePath: 'college-football',
    venueLeague: 'ncaa-football',
    groups: '80',
    cacheKey: 'cfb:slate:current',
  });
}
