import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  generateSnapshot,
  getSnapshot,
  getLatestSnapshot,
  listSnapshots,
  getOperationalHealthSummary,
  OperationalHealthError,
} from '../../../../lib/operational-health';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'current';

    if (action === 'current') {
      const id = url.searchParams.get('id');
      const snapshot = id ? await getSnapshot(id) : await getLatestSnapshot();
      return jsonResponse({ snapshot });
    }

    if (action === 'history') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 100)) : 100;
      const snapshots = await listSnapshots(limit);
      return jsonResponse({ snapshots });
    }

    if (action === 'summary') {
      const summary = await getOperationalHealthSummary();
      return jsonResponse({ summary });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'operational_health_failed', message: err?.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(session ?? '');
    if (!actor) return jsonResponse({ error: 'actor_required', message: 'No operator id resolved from session' }, 400);

    if (action === 'generate-snapshot') {
      const snapshot = await generateSnapshot(actor);
      return jsonResponse({ snapshot });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof OperationalHealthError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'operational_health_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
