import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getBet } from '../../../lib/bet-store';

export const GET: APIRoute = async ({ params, request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing bet ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bet = await getBet(id);
  if (!bet) {
    return new Response(JSON.stringify({ error: 'Bet not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Users can only see their own bets
  if (bet.userId !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(bet), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
