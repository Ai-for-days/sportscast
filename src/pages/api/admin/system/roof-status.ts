import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { setRoofOverride, type RoofOverride } from '../../../../lib/roof-override';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Body: { overrides: { venueId: string; value: 'default' | 'open' | 'closed' }[] } */
export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const rows = Array.isArray(body?.overrides) ? body.overrides : [];
  await Promise.all(
    rows.map((r: any) => {
      const venueId = typeof r?.venueId === 'string' ? r.venueId : null;
      if (!venueId) return Promise.resolve();
      const value: RoofOverride | null = r?.value === 'open' || r?.value === 'closed' ? r.value : null;
      return setRoofOverride(venueId, value);
    }),
  );

  return jsonResponse({ ok: true });
};
