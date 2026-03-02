import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getWagerBets } from '../../../lib/bet-store';
import { getWagerExposure } from '../../../lib/exposure';
import { getUserById } from '../../../lib/user-store';

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

    // Enrich bets with user info
    const enrichedBets = await Promise.all(
      bets.map(async (bet) => {
        const user = await getUserById(bet.userId);
        return {
          ...bet,
          userEmail: user?.email || 'unknown',
          userDisplayName: user?.displayName || 'unknown',
        };
      })
    );

    return new Response(JSON.stringify({ bets: enrichedBets, exposure }), {
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
