import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { reverifyAllEntries } from '../../../../lib/forecast-tracker-store';

export const maxDuration = 60; // Allow up to 60s on Vercel

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await reverifyAllEntries();
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
