import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { updateWager, deleteWager, getWager } from '../../../../lib/wager-store';

export const PUT: APIRoute = async ({ params, request }) => {
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
    const wager = await updateWager(id, body);
    if (!wager) {
      return new Response(JSON.stringify({ error: 'Wager not found or not editable' }), {
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
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
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

  const deleted = await deleteWager(id);
  if (!deleted) {
    return new Response(JSON.stringify({ error: 'Wager not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

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
    return new Response(JSON.stringify({ error: 'Missing wager ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const wager = await getWager(id);
  if (!wager) {
    return new Response(JSON.stringify({ error: 'Wager not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(wager), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
