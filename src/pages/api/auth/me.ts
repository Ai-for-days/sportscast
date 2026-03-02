import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { sanitizeUser } from '../../../lib/user-store';

export const GET: APIRoute = async ({ request }) => {
  const user = await requireUser(request);

  if (!user) {
    return new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ user: sanitizeUser(user) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
