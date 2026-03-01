import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { gradeWager } from '../../../../../lib/wager-store';

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
    const { observedValue, winningOutcome } = body as { observedValue?: number; winningOutcome?: string };

    if (typeof observedValue !== 'number') {
      return new Response(JSON.stringify({ error: 'observedValue (number) is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!winningOutcome || typeof winningOutcome !== 'string') {
      return new Response(JSON.stringify({ error: 'winningOutcome (string) is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const wager = await gradeWager(id, observedValue, winningOutcome);
    if (!wager) {
      return new Response(JSON.stringify({ error: 'Wager not found or cannot be graded' }), {
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
