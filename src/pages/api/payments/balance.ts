import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getBalance } from '../../../lib/wallet-store';

export const GET: APIRoute = async ({ request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const balanceCents = await getBalance(user.id);

  return new Response(JSON.stringify({ balanceCents }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
