// Sports offered in the "Place a Bet" sidebar dropdown, and how each maps to
// an odds-feed league.
//
// 2026-11-06: the dropdown said "College Basketball" while listing NFL games,
// because the games API silently fell back to NFL for any sport the pushed
// odds feed does not carry. The fix then cut the dropdown to the four fed
// sports, and Derek said that was worse: "The sidebar should have all sports".
// So every sport is listed again. Sports with odds come first; the rest have
// `league: null`, and the games API answers them with an empty list flagged
// `unsupported`, which the sidebar shows as "no odds posted yet". An unknown
// or unfed sport still never gets another sport's games.
//
// To give a listed sport real odds: add it to the scraper/pusher and
// FEED_LEAGUES, then set its `league` here.

import { FEED_LEAGUES } from './odds-feed';

export interface SidebarSport {
  name: string;
  /** Bovada sport path, used as the dropdown value and the ?sport= param. */
  path: string;
  icon?: string;
  /** The odds-feed league key this sport's games are stored under, or null when we carry no odds for it yet. */
  league: (typeof FEED_LEAGUES)[number] | null;
}

export const SIDEBAR_SPORTS: readonly SidebarSport[] = [
  // Sports with odds in the feed.
  { name: 'NFL', path: 'football/nfl', icon: '🏈', league: 'nfl' },
  { name: 'College Football', path: 'football/college-football', icon: '🏈', league: 'ncaa-football' },
  { name: 'MLB', path: 'baseball/mlb', icon: '⚾', league: 'mlb' },
  // The feed stores MLS and NWSL together under 'mls' (see FeedGame.league),
  // so they are one entry, labeled like the MLS & Soccer Weatherboard.
  { name: 'MLS & Soccer', path: 'soccer/north-america/united-states/mls', icon: '⚽', league: 'mls' },
  // Listed, no odds in the feed yet.
  { name: 'College Basketball', path: 'basketball/college-basketball', icon: '🏀', league: null },
  { name: 'NBA', path: 'basketball/nba', icon: '🏀', league: null },
  { name: 'NHL', path: 'ice-hockey/nhl', icon: '🏒', league: null },
  { name: 'AHL', path: 'ice-hockey/ahl', icon: '🏒', league: null },
  { name: 'UFC / MMA', path: 'mma/ufc', icon: '🥊', league: null },
  { name: 'Boxing', path: 'boxing/boxing', icon: '🥊', league: null },
  { name: 'Tennis', path: 'tennis/tennis', icon: '🎾', league: null },
  { name: 'Golf', path: 'golf/golf', icon: '⛳', league: null },
  { name: 'Major League Cricket', path: 'cricket/mlc', icon: '🏏', league: null },
  { name: 'Cricket', path: 'cricket/international', icon: '🏏', league: null },
  { name: 'Rugby Union', path: 'rugby/union', icon: '🏉', league: null },
  { name: 'Australian Rules', path: 'afl/afl', icon: '🏈', league: null },
  { name: 'Darts', path: 'darts/darts', icon: '🎯', league: null },
  { name: 'Snooker', path: 'snooker/snooker', icon: '🎱', league: null },
  { name: 'Table Tennis', path: 'table-tennis/table-tennis', icon: '🏓', league: null },
  { name: 'Badminton', path: 'badminton/badminton', icon: '🏸', league: null },
  { name: 'Handball', path: 'handball/handball', icon: '🤾', league: null },
  { name: 'Esports', path: 'esports/esports', icon: '🎮', league: null },
];

/** The feed league for a ?sport= path, or null when we carry no odds for it. */
export function feedLeagueForSport(sportPath: string): NonNullable<SidebarSport['league']> | null {
  return SIDEBAR_SPORTS.find((s) => s.path === sportPath)?.league ?? null;
}
