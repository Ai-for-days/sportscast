import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { createWager } from '../../../lib/wager-store';
import { validateCreateWager } from '../../../lib/wager-validation';

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
