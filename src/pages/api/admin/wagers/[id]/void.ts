import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { voidWager } from '../../../../../lib/wager-store';

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

  try {
    const body = await request.json();
    const { reason } = body as { reason?: string };
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Void reason is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const wager = await voidWager(id, reason.trim());
    if (!wager) {
      return new Response(JSON.stringify({ error: 'Wager not found or already void' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(wager), {
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
