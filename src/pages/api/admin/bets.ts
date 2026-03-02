import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getWagerBets } from '../../../lib/bet-store';
import { getWagerExposure } from '../../../lib/exposure';

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const wagerId = url.searchParams.get('wagerId');

  if (!wagerId) {
    return new Response(JSON.stringify({ error: 'wagerId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const [bets, exposure] = await Promise.all([
      getWagerBets(wagerId),
      getWagerExposure(wagerId),
    ]);

    return new Response(JSON.stringify({ bets, exposure }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
