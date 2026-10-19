import type { APIRoute } from 'astro';

const SPORTSBOOK_URL = 'http://localhost:8765';

interface SportsbookGame {
  id: string;
  description: string;
  startTime: number;
  live: boolean;
  groups: Array<{
    markets: Array<{
      key: string;
      description: string;
      outcomes: Array<{
        type: 'A' | 'H' | 'O' | 'U';
        description: string;
        american?: string | null;
        handicap?: string | null;
      }>;
    }>;
  }>;
}

interface Market {
  key: string;
  description: string;
  outcomes: Array<{
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

function extractMainLines(game: SportsbookGame): Omit<GameWithOdds, 'id' | 'description' | 'startTime' | 'startTimeISO' | 'live'> {
  const markets = game.groups?.[0]?.markets || [];

  const result: Omit<GameWithOdds, 'id' | 'description' | 'startTime' | 'startTimeISO' | 'live'> = {};

  for (const market of markets) {
    const key = (market.key || '').toUpperCase();
    const desc = (market.description || '').toUpperCase();

    // Moneyline
    if (key.includes('12') || key.includes('1X2') || desc.includes('MONEYLINE') || desc.includes('WINNER')) {
      const away = market.outcomes.find((o) => o.type === 'A');
      const home = market.outcomes.find((o) => o.type === 'H');
      if (away?.american && home?.american) {
        result.moneyline = {
          away: parseAmericanOdds(away.american) || 0,
          home: parseAmericanOdds(home.american) || 0,
        };
      }
    }

    // Spread/Run line
    if (key.includes('HCAP') || desc.includes('SPREAD') || desc.includes('RUN LINE') || desc.includes('PUCK LINE')) {
      const away = market.outcomes.find((o) => o.type === 'A');
      const home = market.outcomes.find((o) => o.type === 'H');
      if (away && home) {
        result.spread = {
          away: { point: parseFloat(away.handicap || '0') || 0, price: parseAmericanOdds(away.american) || 0 },
          home: { point: parseFloat(home.handicap || '0') || 0, price: parseAmericanOdds(home.american) || 0 },
        };
      }
    }

    // Over/Under
    if (key.includes('OU') || desc.includes('TOTAL')) {
      const over = market.outcomes.find((o) => o.type === 'O');
      const under = market.outcomes.find((o) => o.type === 'U');
      if (over && under) {
        result.total = {
          point: parseFloat(over.handicap || '0') || 0,
          over: parseAmericanOdds(over.american) || 0,
          under: parseAmericanOdds(under.american) || 0,
        };
      }
    }
  }

  return result;
}

function extractAllMarketGroups(game: SportsbookGame): Record<string, Market[]> {
  const allMarkets: Record<string, Market[]> = {};

  for (const group of game.groups || []) {
    for (const market of group.markets || []) {
      const key = market.key || 'unknown';
      if (!allMarkets[key]) {
        allMarkets[key] = [];
      }
      allMarkets[key].push(market);
    }
  }

  return allMarkets;
}

export const GET: APIRoute = async ({ url }) => {
  const sport = url.searchParams.get('sport') || 'football/nfl';

  try {
    const res = await fetch(`${SPORTSBOOK_URL}/api/board?path=${encodeURIComponent(sport)}`, {
      timeout: 5000,
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch from sportsbook', status: res.status }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const games: GameWithOdds[] = [];

    for (const league of data.leagues || []) {
      for (const game of league.events || []) {
        const lines = extractMainLines(game);
        const allMarkets = extractAllMarketGroups(game);
        games.push({
          id: game.id,
          description: game.description,
          startTime: game.startTime,
          startTimeISO: new Date(game.startTime).toISOString(),
          live: game.live || false,
          allMarkets,
          ...lines,
        });
      }
    }

    return new Response(JSON.stringify({ games, fetchedAt: data.fetchedAt, site: data.site }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error fetching games from sportsbook:', err?.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch games', details: err?.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
