import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getWesConfig, setWesConfig, resetWesConfig } from '../../../../lib/wes';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Current WES weight configuration. */
export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = await getWesConfig();
  return jsonResponse({ config });
};

/**
 * Two actions:
 *  - { action: 'set-config', top?, environmental?, fan?, player? } — patches
 *    any subset of the weight groups; unspecified fields keep their current value.
 *  - { action: 'reset' } — restores the WES 1.0 default weights.
 */
export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* ignore — treated as empty body below */
  }
  const action = body?.action as string | undefined;

  if (action === 'reset') {
    const config = await resetWesConfig();
    return jsonResponse({ config });
  }

  if (action === 'set-config') {
    const config = await setWesConfig({
      top: body.top,
      environmental: body.environmental,
      fan: body.fan,
      player: body.player,
    });
    return jsonResponse({ config });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
};
