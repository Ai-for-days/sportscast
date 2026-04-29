import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../lib/admin-auth';
import {
  generatePricingRecommendation,
  listPricingRecommendations,
  getPricingRecommendation,
  PricingEngineError,
  type PricingMode,
  type FairProbabilityOverrides,
} from '../../../lib/wager-pricing-engine';
import type { CreateWagerInput } from '../../../lib/wager-types';

export const prerender = false;

const VALID_MODES: PricingMode[] = ['fair', 'standard_margin', 'aggressive_margin', 'custom_margin'];

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
      const recommendations = await listPricingRecommendations(limit);
      return jsonResponse({ recommendations });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const rec = await getPricingRecommendation(id);
      if (!rec) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ recommendation: rec });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'wager_pricing_engine_failed', message: err?.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const action = (body.action as string | undefined) ?? 'generate';

  try {
    const actor = await getOperatorId(session ?? '');
    if (!actor) return jsonResponse({ error: 'actor_required', message: 'No operator id resolved from session' }, 400);

    if (action === 'generate') {
      const input = body.input as CreateWagerInput | undefined;
      if (!input || typeof input !== 'object') {
        return jsonResponse({ error: 'input_required', message: 'input (CreateWagerInput) is required' }, 400);
      }
      const pricingMode = body.pricingMode as PricingMode;
      if (!pricingMode || !VALID_MODES.includes(pricingMode)) {
        return jsonResponse({ error: 'invalid_mode', message: `pricingMode must be one of: ${VALID_MODES.join(', ')}` }, 400);
      }

      let customMarginPct: number | undefined;
      if (pricingMode === 'custom_margin') {
        const c = Number(body.customMarginPct);
        if (!Number.isFinite(c)) {
          return jsonResponse({ error: 'custom_margin_required', message: 'customMarginPct is required for custom_margin' }, 400);
        }
        if (c < 0 || c > 20) {
          return jsonResponse({ error: 'custom_margin_out_of_range', message: 'customMarginPct must be between 0 and 20' }, 400);
        }
        customMarginPct = c;
      }

      const fairProbabilities = body.fairProbabilities as FairProbabilityOverrides | undefined;

      const recommendation = await generatePricingRecommendation(input, actor, {
        pricingMode, customMarginPct, fairProbabilities,
      });
      return jsonResponse({ recommendation });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof PricingEngineError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'wager_pricing_engine_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
