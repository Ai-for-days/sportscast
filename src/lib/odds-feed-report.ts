// Which games the pushed odds feed did and did not match (2026-10-13).
//
// For /admin/system/odds-feed. Derek asked for every feed game that fails to
// match to be visible "so I can fix aliases quickly"; the fix is a line in
// odds-team-aliases.ts. Two lists per league:
//   ourUnmatched   our games with no feed game: these show no odds on the board,
//                  so they are the ones that matter
//   feedUnmatched  feed games we did not place. Many are expected (the feed
//                  lists every FBS and FCS game; we only track games at venues
//                  in venue-data), so this list is for spotting a name problem
//                  when a team we DO track appears in it.

import { getScheduleGames } from './league-schedule';
import { getFeedSummaries, type FeedSummary } from './odds-feed-store';
import { matchFeedGame } from './odds-feed-match';
import { FEED_LEAGUES } from './odds-feed';
import { chooseFeedLines } from './odds-source';

export interface LeagueMatchReport {
  league: string;
  ourGames: number;
  feedGames: number;
  matched: number;
  /** Matched games whose feed lines are currently fresh enough to show. */
  showing: number;
  ourUnmatched: { home: string; away: string; kickoffUTC: string }[];
  feedUnmatched: { id: string; description: string; startTime: number }[];
  error?: string;
}

export async function buildMatchReport(windowDays = 3): Promise<LeagueMatchReport[]> {
  const now = Date.now();
  return Promise.all(
    FEED_LEAGUES.map(async (league): Promise<LeagueMatchReport> => {
      try {
        const [{ games }, feed] = await Promise.all([
          getScheduleGames(league as any, windowDays, undefined, { lite: true }),
          getFeedSummaries(league),
        ]);
        const upcomingFeed = feed.filter((s) => s.startTime > now - 6 * 3600_000);
        const candidates = upcomingFeed.map((s) => ({ id: s.id, startTime: s.startTime, home: s.home, away: s.away, homeShort: s.homeShort, awayShort: s.awayShort }));
        const byId = new Map<string, FeedSummary>(upcomingFeed.map((s) => [s.id, s]));
        const used = new Set<string>();
        const ourUnmatched: LeagueMatchReport['ourUnmatched'] = [];
        let showing = 0;
        for (const g of games) {
          const m = matchFeedGame(league, { homeTeam: g.homeTeam, awayTeam: g.awayTeam, kickoffUTC: g.kickoffUTC, neutralSite: g.neutralSite }, candidates);
          if (m) {
            used.add(m.id);
            const s = byId.get(m.id);
            if (s && chooseFeedLines(s, now)) showing += 1;
          } else if (g.state !== 'post') {
            ourUnmatched.push({ home: g.homeTeam, away: g.awayTeam, kickoffUTC: g.kickoffUTC });
          }
        }
        const feedUnmatched = upcomingFeed
          .filter((s) => !used.has(s.id))
          .sort((a, b) => a.startTime - b.startTime)
          .map((s) => ({ id: s.id, description: s.description, startTime: s.startTime }));
        return { league, ourGames: games.length, feedGames: upcomingFeed.length, matched: used.size, showing, ourUnmatched, feedUnmatched };
      } catch (e) {
        return { league, ourGames: 0, feedGames: 0, matched: 0, showing: 0, ourUnmatched: [], feedUnmatched: [], error: String(e).slice(0, 200) };
      }
    }),
  );
}
