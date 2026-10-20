import type { APIRoute } from 'astro';
import { getFeedSummaries, getFeedGame } from '../../../lib/odds-feed-store';
import type { FeedSummary, FeedGame } from '../../../lib/odds-feed';

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
}

function parseAmericanOdds(american: string | null | undefined): number | null {
  if (!american) return null;
  const num = parseInt(american, 10);
  return Number.isNaN(num) ? null : num;
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
        key: market.key,
        description: market.description,
        outcomes: market.outcomes.map(o => ({
          id: o.id,
          type: o.type as 'A' | 'H' | 'O' | 'U',
          description: o.description,
          american: o.american,
          handicap: o.handicap,
        })),
      });
    }
  }

  return allMarkets;
}

function mapLeagueFromSport(sport: string): string {
  if (sport.includes('nfl')) return 'nfl';
  if (sport.includes('college-football')) return 'ncaa-football';
  if (sport.includes('mlb')) return 'mlb';
  if (sport.includes('mls')) return 'mls';
  return 'nfl';
}

export const GET: APIRoute = async ({ url }) => {
  const sport = url.searchParams.get('sport') || 'football/nfl';
  const league = mapLeagueFromSport(sport);

  try {
    const summaries = await getFeedSummaries(league);
    const games: GameWithOdds[] = [];

    for (const summary of summaries) {
      const fullGame = await getFeedGame(summary.id);
      const allMarkets = fullGame ? extractAllMarketGroups(fullGame.game) : {};

      const lines = summary.lines || summary.liveLines;
      games.push({
        id: summary.id,
        description: summary.description,
        startTime: summary.startTime,
        startTimeISO: new Date(summary.startTime).toISOString(),
        live: !!summary.liveLines,
        moneyline: lines?.moneyline ? {
          away: parseAmericanOdds(lines.moneyline.away) || 0,
          home: parseAmericanOdds(lines.moneyline.home) || 0,
        } : undefined,
        spread: lines?.spread ? {
          away: { point: parseFloat(lines.spread.away.point) || 0, price: parseAmericanOdds(lines.spread.away.american) || 0 },
          home: { point: parseFloat(lines.spread.home.point) || 0, price: parseAmericanOdds(lines.spread.home.american) || 0 },
        } : undefined,
        total: lines?.total ? {
          point: parseFloat(lines.total.point) || 0,
          over: parseAmericanOdds(lines.total.over) || 0,
          under: parseAmericanOdds(lines.total.under) || 0,
        } : undefined,
        allMarkets: Object.keys(allMarkets).length > 0 ? allMarkets : undefined,
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
