import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../lib/admin-auth';
import {
  listGradedWagersForSettlementPreview,
  generateSettlementPreview,
  getSettlementPreview,
  getLatestSettlementPreviewForWager,
  listSettlementPreviews,
  SettlementPreviewError,
} from '../../../lib/wager-settlement-preview';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list-graded';

    if (action === 'list-graded') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const wagers = await listGradedWagersForSettlementPreview(limit);
      return jsonResponse({ wagers });
    }

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 100)) : 100;
      const previews = await listSettlementPreviews(limit);
      return jsonResponse({ previews });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const preview = await getSettlementPreview(id);
      if (!preview) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ preview });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const preview = await getLatestSettlementPreviewForWager(wagerId);
      return jsonResponse({ preview });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'wager_settlement_preview_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'generate') {
      if (!body.wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const preview = await generateSettlementPreview(body.wagerId, actor);
      return jsonResponse({ preview });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof SettlementPreviewError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'wager_settlement_preview_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
