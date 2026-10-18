import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getBalance } from '../../../lib/wallet-store';

export const GET: APIRoute = async ({ request }) => {
  const user = await requireUser(request);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const balanceCents = await getBalance(user.id);
    const balanceDollars = balanceCents / 100;

    return new Response(JSON.stringify({ balanceCents, balanceDollars, user: { id: user.id, displayName: user.displayName } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[Balance error]', err?.message);
    return new Response(JSON.stringify({ error: 'Failed to get balance' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
