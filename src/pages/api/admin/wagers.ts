import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { createWager, listAllWagersPage } from '../../../lib/wager-store';
import { validateCreateWager } from '../../../lib/wager-validation';

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 2026-08-26: paged, so the dashboard can reach the whole book instead of
    // just the 200 newest records. `total` drives its Load more control.
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 500);
    const cursor = parseInt(url.searchParams.get('cursor') || '0', 10) || 0;
    const { wagers, total } = await listAllWagersPage(limit, cursor);
    return new Response(JSON.stringify({ wagers, total }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const validation = validateCreateWager(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({ errors: validation.errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const wager = await createWager(body);
    return new Response(JSON.stringify(wager), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed to create wager' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
