import type { APIRoute } from 'astro';
import { requireAdmin, isReadOnly } from '../../../lib/admin-auth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const readOnly = await isReadOnly(session);

  return new Response(JSON.stringify({ readOnly }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
