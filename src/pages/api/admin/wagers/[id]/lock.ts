import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { lockWagerNow } from '../../../../../lib/wager-store';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing wager ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const wager = await lockWagerNow(id);
  if (!wager) {
    return new Response(JSON.stringify({ error: 'Wager not found or not open' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(wager), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
