import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { reverifyBatch } from '../../../../lib/forecast-tracker-store';

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let cursor = 0;
    let batchSize = 15;

    // Accept params from JSON body or query string
    try {
      const body = await request.json();
      if (typeof body.cursor === 'number') cursor = body.cursor;
      if (typeof body.batchSize === 'number') batchSize = Math.min(body.batchSize, 30);
    } catch {
      // No JSON body — use defaults
    }

    const result = await reverifyBatch(cursor, batchSize);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Re-verify failed', details: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
