// GET /api/odds/history?id=<gameId>&market=<marketId>: one market's line movement (2026-10-13).
// Public, read-only prices; feeds the chart on /weatherboard/game/<id>.

import type { APIRoute } from 'astro';
import { getMarketHistory } from '../../../lib/odds-feed-store';

export const prerender = false;

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  const market = url.searchParams.get('market') ?? '';
  if (!ID.test(id) || !ID.test(market)) {
    return new Response(JSON.stringify({ error: 'bad id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const hist = await getMarketHistory(id, [market]);
  return new Response(JSON.stringify({ points: hist[market] ?? [] }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=20' },
  });
};
