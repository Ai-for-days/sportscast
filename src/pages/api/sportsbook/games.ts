import type { APIRoute } from 'astro';
import { getFeedSummaries, getFeedGame } from '../../../lib/odds-feed-store';
import type { FeedGame } from '../../../lib/odds-feed';
import { feedLeagueForSport } from '../../../lib/sportsbook-sports';
import { getGameLines } from '../../../lib/sportsbook-odds';
import { getPublicRotationPairs } from '../../../lib/public-rotations';
import { SPORTSBOOK_GAMES_CACHE_CONTROL } from '../../../lib/cache-headers';
import { keepOnSidebar, sidebarLines, scoresByFeedId, type SidebarScore } from '../../../lib/sidebar-games';
import { getScheduleGames, type SiteLeague } from '../../../lib/league-schedule';

interface Market {
  id: string;
  key: string;
  description: string;
  outcomes: Array<{
    id: string;
    type: 'A' | 'H' | 'O' | 'U';
    description: string;
    american?: string | null;
    handicap?: string | null;
  }>;
}

interface GameWithOdds {
  id: string;
  description: string;
  startTime: number;
  startTimeISO: string;
  live: boolean;
  moneyline?: { away: number; home: number };
  spread?: { away: { point: number; price: number }; home: { point: number; price: number } };
  total?: { point: number; over: number; under: number };
  allMarkets?: Record<string, Market[]>;
  /** Official rotation numbers (The Odds API, same source as the Weatherboard # column); null when not posted or unavailable. */
  awayRotation: number | null;
  homeRotation: number | null;
  /** ESPN score once the game has started (DBD 2026-11-21); absent before kickoff or when unmatched. */
  score?: SidebarScore;
}


function extractAllMarketGroups(game: FeedGame): Record<string, Market[]> {
  const allMarkets: Record<string, Market[]> = {};

  for (const group of game.groups || []) {
    for (const market of group.markets || []) {
      const key = market.key || 'unknown';
      if (!allMarkets[key]) {
        allMarkets[key] = [];
      }
      allMarkets[key].push({
        id: market.id,
        key: market.key ?? key,
        description: market.description,
        outcomes: market.outcomes.map(o => ({
          id: o.id,
          type: o.type as 'A' | 'H' | 'O' | 'U',
          description: o.description,
          american: o.price?.american ?? null,
          handicap: o.price?.handicap ?? null,
        })),
      });
    }
  }

  return allMarkets;
}

export const GET: APIRoute = async ({ url }) => {
  const sport = url.searchParams.get('sport') || 'football/nfl';
  // Unknown sport = no games. Never fall back to another sport's games
  // (that showed NFL games under "College Basketball", 2026-11-06).
  const league = feedLeagueForSport(sport);
  if (!league) {
    return new Response(JSON.stringify({ games: [], fetchedAt: Date.now(), unsupported: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': SPORTSBOOK_GAMES_CACHE_CONTROL },
    });
  }

  try {
    // DBD 2026-11-21: games stay up until 6 AM ET after their game day.
    const now = Date.now();
    const summaries = (await getFeedSummaries(league)).filter((s) => keepOnSidebar(s.startTime, now));
    // Scores, from the same ESPN schedule the Weatherboard reads. Any failure
    // just means no scores; the prices still show.
    let scores = new Map<string, SidebarScore>();
    if (summaries.some((s) => s.startTime <= now)) {
      try {
        const sched = await getScheduleGames(league as SiteLeague, 1, undefined, { lite: true });
        scores = scoresByFeedId(league, sched.games, summaries);
      } catch { /* no scores */ }
    }
    const games: GameWithOdds[] = [];
    // Rotation numbers, per Derek (2026-11-06): "we need for all of them to
    // have rotation numbers". Same source and matching as the Weatherboard
    // # column; getGameLines reads the shared per-sport Odds API cache, so
    // this adds no per-game API calls. Any failure just leaves them null.
    const rotations = await Promise.all(
      summaries.map((s) => getGameLines(league, s.home, s.away, new Date(s.startTime).toISOString()).catch(() => null)),
    );

    // Backup: the public schedule file, for games The Odds API did not give
    // a number (see public-rotations.ts). One cached file, no per-game calls.
    const publicPairs = await getPublicRotationPairs(
      league,
      summaries.map((s) => ({ homeTeam: s.home, awayTeam: s.away, kickoffUTC: new Date(s.startTime).toISOString() })),
    );

    for (const [idx, summary] of summaries.entries()) {
      const fullGame = await getFeedGame(summary.id);
      const allMarkets = fullGame ? extractAllMarketGroups(fullGame.game) : {};

      // Stored lines are already-parsed GameLines numbers (odds-feed.ts
      // mainLinesFromGame), not raw strings. Reading the wrong field names
      // here left every sidebar price blank, shown as "(—)" (2026-11-06).
      // In-game prices win once the game has started, as on the boards.
      // In-game prices where Bovada posts them; the pre-game line fills any
      // suspended market, and a finished game shows its pre-game (closing)
      // line, so the prices never go blank (DBD 2026-11-21).
      const started = summary.startTime <= now;
      const score = scores.get(summary.id);
      const chosen = sidebarLines(summary.lines, summary.liveLines, started, score?.state === 'post');
      const lines = chosen.lines;
      games.push({
        id: summary.id,
        description: summary.description,
        startTime: summary.startTime,
        startTimeISO: new Date(summary.startTime).toISOString(),
        live: chosen.live,
        moneyline: lines && lines.moneylineAway !== null && lines.moneylineHome !== null
          ? { away: lines.moneylineAway, home: lines.moneylineHome }
          : undefined,
        spread: lines?.spreadAway && lines.spreadHome
          ? { away: { point: lines.spreadAway.point, price: lines.spreadAway.price }, home: { point: lines.spreadHome.point, price: lines.spreadHome.price } }
          : undefined,
        total: lines?.total
          ? { point: lines.total.point, over: lines.total.overPrice, under: lines.total.underPrice }
          : undefined,
        allMarkets: Object.keys(allMarkets).length > 0 ? allMarkets : undefined,
        awayRotation: rotations[idx]?.awayRotation ?? publicPairs[idx]?.away ?? null,
        homeRotation: rotations[idx]?.homeRotation ?? publicPairs[idx]?.home ?? null,
        ...(score ? { score } : {}),
      });
    }

    // WOW-034: header only, the body is unchanged. Same for every caller
    // (this handler never reads the request's cookies; cookie-invariance.test.ts).
    return new Response(JSON.stringify({ games, fetchedAt: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': SPORTSBOOK_GAMES_CACHE_CONTROL },
    });
  } catch (err: any) {
    console.error('Error fetching games from odds feed:', err?.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch games', details: err?.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
