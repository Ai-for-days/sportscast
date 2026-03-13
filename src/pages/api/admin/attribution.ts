import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { generateAttribution } from '../../../lib/attribution';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const attribution = await generateAttribution();
    return new Response(JSON.stringify({ attribution }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
