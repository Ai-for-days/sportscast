/**
 * Pairs a game's two venues with its Bovada feed game and back (DBD 2026-11-18): the weather-wager game
 * page (/wagers/game) shows the game's Bovada markets below our weather markets, and the odds page
 * (/weatherboard/game/<id>) gets our weather markets as its last tab. Pure apart from the inputs.
 */
import { nameScore } from './odds-feed-match';
import { isTempMetric, locationMatchesVenue } from './weatherboard-markets';
import { isPubliclyViewable } from './public-wager-view';
import type { Wager } from './wager-types';
import type { Venue } from './types';

const ET = 'America/New_York';

export function etDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: ET });
}

/**
 * Every published weather market for a game: pointspreads touching either venue, and over/unders at either
 * venue, on the temperature metrics the board uses (high, low, and the game-start "actual_temp" O/U).
 * The page used to keep its own copy of isTempMetric without actual_temp, which hid the game-start O/U
 * markets the board shows.
 */
export function gameWeatherWagers(dayWagers: Wager[], home: Venue, away: Venue): Wager[] {
  return dayWagers.filter((w) => {
    if (!isPubliclyViewable(w)) return false;
    if (w.kind === 'pointspread') {
      if (!isTempMetric(w.metricA ?? w.metric) || !isTempMetric(w.metricB ?? w.metric)) return false;
      return [w.locationA, w.locationB].some((l) => locationMatchesVenue(l, home) || locationMatchesVenue(l, away));
    }
    if (w.kind === 'over-under') {
      if (!isTempMetric(w.metric)) return false;
      return locationMatchesVenue(w.location, home) || locationMatchesVenue(w.location, away);
    }
    return false;
  });
}

export interface FeedSide {
  id: string;
  startTime: number;
  home: string;
  away: string;
  homeShort?: string | null;
  awayShort?: string | null;
}

/** The feed game on this Eastern date whose two teams are these venues' teams (either way round). */
export function feedGameForVenues<T extends FeedSide>(league: string, feed: T[], home: Venue, away: Venue, date: string): T | null {
  let best: { s: T; score: number } | null = null;
  for (const s of feed) {
    if (etDate(s.startTime) !== date) continue;
    for (const [h, a] of [
      [nameScore(league, s.home, home.team ?? '', s.homeShort), nameScore(league, s.away, away.team ?? '', s.awayShort)],
      [nameScore(league, s.away, home.team ?? '', s.awayShort), nameScore(league, s.home, away.team ?? '', s.homeShort)],
    ]) {
      if (h === 0 || a === 0 || (h === 1 && a === 1)) continue;
      if (!best || h + a > best.score) best = { s, score: h + a };
    }
  }
  return best ? best.s : null;
}

/** Our venue for a feed team name: the best name match in that league, ties broken by list order. */
export function venueForFeedTeam(league: string, venues: Venue[], feedName: string, feedShort?: string | null): Venue | null {
  let best: { v: Venue; score: number } | null = null;
  for (const v of venues) {
    if (!v.team) continue;
    const score = nameScore(league, feedName, v.team, feedShort);
    if (score > 0 && (!best || score > best.score)) best = { v, score };
  }
  return best && best.score >= 2 ? best.v : null;
}
