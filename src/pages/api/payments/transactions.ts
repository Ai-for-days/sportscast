import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getTransactions } from '../../../lib/wallet-store';

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

  const { transactions, total } = await getTransactions(user.id, limit, offset);

  return new Response(JSON.stringify({ transactions, total }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
