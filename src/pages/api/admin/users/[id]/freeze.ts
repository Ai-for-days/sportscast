import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { freezeUser } from '../../../../../lib/user-store';

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
    return new Response(JSON.stringify({ error: 'Missing user ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { frozen } = body as { frozen?: boolean };

    if (typeof frozen !== 'boolean') {
      return new Response(JSON.stringify({ error: 'frozen must be a boolean' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = await freezeUser(id, frozen);
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, frozen: user.frozen }), {
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
