import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getUserById, sanitizeUser } from '../../../../lib/user-store';
import { getBalance, getTransactions } from '../../../../lib/wallet-store';
import { getUserBets } from '../../../../lib/bet-store';

export const GET: APIRoute = async ({ params, request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing user ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const user = await getUserById(id);
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [balanceCents, betsData, txData] = await Promise.all([
      getBalance(user.id),
      getUserBets(user.id, 50),
      getTransactions(user.id, 50),
    ]);

    return new Response(JSON.stringify({
      user: {
        ...sanitizeUser(user),
        hasPassword: !!user.passwordHash,
      },
      balanceCents,
      bets: betsData.bets,
      transactions: txData.transactions,
    }), {
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
