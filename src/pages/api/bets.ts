import type { APIRoute } from 'astro';
import { requireUser } from '../../lib/user-auth';
import { placeBet, getUserBets } from '../../lib/bet-store';

export const POST: APIRoute = async ({ request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { wagerId, outcomeLabel, amountCents } = body as {
      wagerId?: string;
      outcomeLabel?: string;
      amountCents?: number;
    };

    if (!wagerId || !outcomeLabel || !amountCents) {
      return new Response(JSON.stringify({ error: 'wagerId, outcomeLabel, and amountCents are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bet = await placeBet(user.id, wagerId, outcomeLabel, amountCents);

    return new Response(JSON.stringify(bet), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const status = err.message.includes('Insufficient') ? 402
      : err.message.includes('not open') ? 409
      : err.message.includes('not found') ? 404
      : 400;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async ({ request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const { bets, total } = await getUserBets(user.id, limit, offset);

  return new Response(JSON.stringify({ bets, total }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
