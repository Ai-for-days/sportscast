import type { APIRoute } from 'astro';

import { SIDEBAR_SPORTS } from '../../../lib/sportsbook-sports';

// Every sport, fed ones first; `hasOdds` is false for sports the odds feed
// does not carry yet (see sportsbook-sports.ts).
export const GET: APIRoute = async () => {
  try {
    const sports = SIDEBAR_SPORTS.map(({ name, path, icon, league }) => ({ name, path, icon, hasOdds: league !== null }));
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
