import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../lib/admin-auth';
import {
  listResolvableWagers,
  generateResolutionPreview,
  manuallyGradeWager,
  manuallyVoidWager,
  getResolutionHistory,
  getRecentGradingActivity,
  WagerResolutionError,
  type ObservedInput,
} from '../../../lib/wager-resolution';
import { getWager } from '../../../lib/wager-store';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list-resolvable';

    if (action === 'list-resolvable') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const wagers = await listResolvableWagers(limit);
      return jsonResponse({ wagers });
    }

    if (action === 'get-wager') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const wager = await getWager(id);
      if (!wager) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ wager });
    }

    if (action === 'history') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const events = await getResolutionHistory(wagerId);
      return jsonResponse({ events });
    }

    if (action === 'recent-activity') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 100)) : 100;
      const events = await getRecentGradingActivity(limit);
      return jsonResponse({ events });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'wager_resolution_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'preview') {
      if (!body.wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const observedInput = (body.observedInput ?? null) as ObservedInput | null;
      const preview = await generateResolutionPreview(body.wagerId, actor, observedInput);
      return jsonResponse({ preview });
    }

    if (action === 'grade') {
      if (!body.wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      if (!body.observedInput) return jsonResponse({ error: 'observed_input_required', message: 'observedInput is required to grade' }, 400);
      const wager = await manuallyGradeWager(body.wagerId, actor, body.observedInput as ObservedInput, body.note);
      return jsonResponse({ wager });
    }

    if (action === 'void') {
      if (!body.wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      if (!body.reason || !String(body.reason).trim()) {
        return jsonResponse({ error: 'reason_required', message: 'reason is required to void a wager' }, 400);
      }
      const wager = await manuallyVoidWager(body.wagerId, actor, String(body.reason));
      return jsonResponse({ wager });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof WagerResolutionError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'wager_resolution_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
