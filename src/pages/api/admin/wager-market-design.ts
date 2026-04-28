import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../lib/admin-auth';
import {
  analyzeMarketDesign,
  listMarketDesignReviews,
  getMarketDesignReview,
  MarketDesignError,
} from '../../../lib/wager-market-design';
import type { CreateWagerInput } from '../../../lib/wager-types';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 100)) : 100;
      const reviews = await listMarketDesignReviews(limit);
      return jsonResponse({ reviews });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const review = await getMarketDesignReview(id);
      if (!review) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ review });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'wager_market_design_failed', message: err?.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const action = (body.action as string | undefined) ?? 'analyze';

  try {
    const reviewerId = await getOperatorId(session ?? '');
    if (!reviewerId) return jsonResponse({ error: 'reviewer_required', message: 'No operator id resolved from session' }, 400);

    if (action === 'analyze') {
      const input = (body.input ?? body) as CreateWagerInput;
      // The body might be the raw CreateWagerInput, or wrapped as { action, input }.
      // Accept both. If it has an "action" key without "input", treat the rest as input.
      const proposed: CreateWagerInput = (body.input ? body.input : { ...body });
      // Strip the wrapping fields if we fell through to the second case
      delete (proposed as any).action;

      const review = await analyzeMarketDesign(proposed, { reviewerId });
      return jsonResponse({ review });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof MarketDesignError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'wager_market_design_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
