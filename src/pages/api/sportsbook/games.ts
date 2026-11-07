import type { APIRoute } from 'astro';
import { getFeedSummaries, getFeedGame } from '../../../lib/odds-feed-store';
import type { FeedGame } from '../../../lib/odds-feed';
import { feedLeagueForSport } from '../../../lib/sportsbook-sports';
import { getGameLines } from '../../../lib/sportsbook-odds';
import { getPublicRotationPairs } from '../../../lib/public-rotations';

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
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const summaries = await getFeedSummaries(league);
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
      const started = summary.startTime <= Date.now();
      const lines = (started && summary.liveLines) || summary.lines || summary.liveLines;
      games.push({
        id: summary.id,
        description: summary.description,
        startTime: summary.startTime,
        startTimeISO: new Date(summary.startTime).toISOString(),
        live: started && !!summary.liveLines,
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
      });
    }

    return new Response(JSON.stringify({ games, fetchedAt: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error fetching games from odds feed:', err?.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch games', details: err?.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
