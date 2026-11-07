// Sports offered in the "Place a Bet" sidebar dropdown, and how each maps to
// an odds-feed league (2026-11-06).
//
// Reported by Derek with a screenshot: the dropdown said "College Basketball"
// while listing NFL games. The dropdown offered 23 sports, but the pushed odds
// feed only carries FEED_LEAGUES (nfl, ncaa-football, mlb, mls), and the games
// API silently fell back to NFL for everything else. Now the dropdown lists
// only sports that actually have odds, and an unknown sport gets no games,
// never another sport's games.
//
// To offer a new sport: add it to the scraper/pusher and FEED_LEAGUES first,
// then add a row here.

import { FEED_LEAGUES } from './odds-feed';

export interface SidebarSport {
  name: string;
  /** Bovada sport path, used as the dropdown value and the ?sport= param. */
  path: string;
  icon?: string;
  /** The odds-feed league key this sport's games are stored under. */
  league: (typeof FEED_LEAGUES)[number];
}

export const SIDEBAR_SPORTS: readonly SidebarSport[] = [
  { name: 'NFL', path: 'football/nfl', icon: '🏈', league: 'nfl' },
  { name: 'College Football', path: 'football/college-football', icon: '🏈', league: 'ncaa-football' },
  { name: 'MLB', path: 'baseball/mlb', icon: '⚾', league: 'mlb' },
  // The feed stores MLS and NWSL together under 'mls' (see FeedGame.league),
  // so they are one entry, labeled like the MLS & Soccer Weatherboard.
  { name: 'MLS & Soccer', path: 'soccer/north-america/united-states/mls', icon: '⚽', league: 'mls' },
];

/** The feed league for a ?sport= path, or null when we carry no odds for it. */
export function feedLeagueForSport(sportPath: string): SidebarSport['league'] | null {
  return SIDEBAR_SPORTS.find((s) => s.path === sportPath)?.league ?? null;
}
