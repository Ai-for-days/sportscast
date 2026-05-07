// ── Public wager detail API (sanitized) ─────────────────────────────────────
//
// Step 120 Part A: every response goes through getPublicWager +
// serializePublicWager so admin-only fields never leak.

import type { APIRoute } from 'astro';
import {
  getPublicWager,
  serializePublicWager,
} from '../../../lib/public-wager-view';

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing wager ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const view = await getPublicWager(id);
    if (!view) {
      return new Response(JSON.stringify({ error: 'Wager not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(serializePublicWager(view)), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, max-age=60',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch wager' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
