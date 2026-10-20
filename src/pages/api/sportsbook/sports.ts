import type { APIRoute } from 'astro';

interface Sport {
  name: string;
  path: string;
  icon?: string;
}

const SPORTS_MAP: Record<string, Sport> = {
  NFL: { name: 'NFL', path: 'football/nfl', icon: '🏈' },
  NCAAF: { name: 'College Football', path: 'football/college-football', icon: '🏈' },
  MLB: { name: 'MLB', path: 'baseball/mlb', icon: '⚾' },
  MLS: { name: 'MLS', path: 'soccer/north-america/united-states/mls', icon: '⚽' },
  NWSL: { name: 'Women\'s Soccer (NWSL)', path: 'soccer/north-america/united-states/usa-nwsl', icon: '⚽' },
};

export const GET: APIRoute = async () => {
  try {
    const sports = Object.values(SPORTS_MAP);
    return new Response(JSON.stringify(sports), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error fetching sports:', err?.message);
    return new Response(JSON.stringify({ error: 'Failed to fetch sports', details: err?.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
