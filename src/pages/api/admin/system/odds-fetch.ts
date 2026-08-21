import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { triggerOddsFetch, getOddsFetchConfig, setOddsFetchConfig } from '../../../../lib/sportsbook-odds';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Current fetch-mode config (auto/manual + interval). */
export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  const config = await getOddsFetchConfig();
  return jsonResponse({ config });
};

/**
 * Two actions:
 *  - { action: 'fetch-now', league?: 'mlb'|'nfl'|'ncaa-football'|'mls' } —
 *    forces a real request now, bypassing cache and manual mode's
 *    no-auto-fetch rule. Omit league to refresh every tracked league.
 *  - { action: 'set-config', mode?: 'auto'|'manual', intervalHours?: number } —
 *    switches fetch mode and/or the auto-mode cache interval.
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

  if (action === 'fetch-now') {
    const results = await triggerOddsFetch(typeof body.league === 'string' ? body.league : undefined);
    return jsonResponse({ results });
  }

  if (action === 'set-config') {
    const config = await setOddsFetchConfig({
      mode: body.mode === 'manual' || body.mode === 'auto' ? body.mode : undefined,
      intervalHours: typeof body.intervalHours === 'number' ? body.intervalHours : undefined,
    });
    return jsonResponse({ config });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
};
