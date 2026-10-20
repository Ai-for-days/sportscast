import type { APIRoute } from 'astro';

interface Sport {
  name: string;
  path: string;
  icon?: string;
}

const SPORTS_MAP: Record<string, Sport> = {
  NFL: { name: 'NFL', path: 'football/nfl', icon: '🏈' },
  NCAAF: { name: 'College Football', path: 'football/college-football', icon: '🏈' },
  NCAAB: { name: 'College Basketball', path: 'basketball/college-basketball', icon: '🏀' },
  NBA: { name: 'All Basketball', path: 'basketball/nba', icon: '🏀' },
  MLB: { name: 'All Baseball', path: 'baseball/mlb', icon: '⚾' },
  NHL: { name: 'NHL', path: 'ice-hockey/nhl', icon: '🏒' },
  AHL: { name: 'All Hockey', path: 'ice-hockey/ahl', icon: '🏒' },
  UFC: { name: 'UFC / MMA', path: 'mma/ufc', icon: '🥊' },
  BOXING: { name: 'Boxing', path: 'boxing/boxing', icon: '🥊' },
  MLS: { name: 'MLS', path: 'soccer/north-america/united-states/mls', icon: '⚽' },
  NWSL: { name: 'NWSL', path: 'soccer/north-america/united-states/usa-nwsl', icon: '⚽' },
  TENNIS: { name: 'Tennis', path: 'tennis/tennis', icon: '🎾' },
  GOLF: { name: 'Golf', path: 'golf/golf', icon: '⛳' },
  CRICKET: { name: 'Major League Cricket', path: 'cricket/mlc', icon: '🏏' },
  CRICKET_INT: { name: 'Cricket', path: 'cricket/international', icon: '🏏' },
  RUGBY: { name: 'Rugby Union', path: 'rugby/union', icon: '🏉' },
  AFL: { name: 'Australian Rules', path: 'afl/afl', icon: '🏈' },
  DARTS: { name: 'Darts', path: 'darts/darts', icon: '🎯' },
  SNOOKER: { name: 'Snooker', path: 'snooker/snooker', icon: '🎱' },
  TABLE_TENNIS: { name: 'Table Tennis', path: 'table-tennis/table-tennis', icon: '🏓' },
  BADMINTON: { name: 'Badminton', path: 'badminton/badminton', icon: '🏸' },
  HANDBALL: { name: 'Handball', path: 'handball/handball', icon: '🤝' },
  ESPORTS: { name: 'Esports', path: 'esports/esports', icon: '🎮' },
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
