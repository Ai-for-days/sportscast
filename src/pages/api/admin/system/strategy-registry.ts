import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createStrategy, getStrategy, listStrategies, updateStrategy, transitionStatus,
  createPromotionSnapshot, getPromotionSnapshot, listPromotionSnapshots, decidePromotion,
  addNote, computeStatusDistribution,
  STRATEGY_STATUSES, type StrategyStatus, TransitionError,
} from '../../../../lib/strategy-registry';

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
      const [strategies, promotions] = await Promise.all([listStrategies(200), listPromotionSnapshots(200)]);
      return jsonResponse({
        strategies,
        promotions,
        statuses: STRATEGY_STATUSES,
        statusDistribution: computeStatusDistribution(strategies),
      });
    }
    if (action === 'detail') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const strategy = await getStrategy(id);
      if (!strategy) return jsonResponse({ error: 'not found' }, 404);
      const allPromos = await listPromotionSnapshots(500);
      const promotions = allPromos.filter(p => p.strategyId === id);
      return jsonResponse({ strategy, promotions });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'strategy_registry_failed', message: err?.message ?? String(err) }, 500);
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
    const operatorId = await getOperatorId((session as any).id ?? '');

    if (action === 'create-strategy') {
      const created = await createStrategy({
        name: body.name,
        description: body.description,
        sourceVariantId: body.sourceVariantId,
        filters: body.filters,
        promotionCriteria: body.promotionCriteria,
        initialStatus: body.initialStatus,
        latestMetrics: body.latestMetrics,
        latestVerdict: body.latestVerdict,
        createdBy: operatorId,
      });
      return jsonResponse({ strategy: created });
    }

    if (action === 'update-strategy') {
      const id = body.id as string;
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const r = await updateStrategy(id, {
        name: body.name,
        description: body.description,
        filters: body.filters,
        promotionCriteria: body.promotionCriteria,
        latestMetrics: body.latestMetrics,
        latestVerdict: body.latestVerdict,
      }, operatorId);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ strategy: r });
    }

    if (action === 'transition-status') {
      const r = await transitionStatus({
        strategyId: body.id,
        toStatus: body.toStatus as StrategyStatus,
        actor: operatorId,
        reason: body.reason,
        promotionSnapshotId: body.promotionSnapshotId,
      });
      return jsonResponse({ strategy: r });
    }

    if (action === 'request-promotion') {
      const r = await createPromotionSnapshot({
        strategyId: body.id,
        requestedStatus: body.requestedStatus as StrategyStatus,
        variantId: body.variantId,
        metricsSnapshot: body.metricsSnapshot,
        readinessVerdict: body.readinessVerdict,
        reasons: body.reasons ?? [],
        requestedBy: operatorId,
        notes: body.notes,
      });
      return jsonResponse({ promotion: r });
    }

    if (action === 'approve-promotion') {
      const r = await decidePromotion({
        snapshotId: body.id,
        decision: 'approve',
        approver: operatorId,
        notes: body.notes,
      });
      return jsonResponse({ promotion: r });
    }

    if (action === 'reject-promotion') {
      const r = await decidePromotion({
        snapshotId: body.id,
        decision: 'reject',
        approver: operatorId,
        notes: body.notes,
      });
      return jsonResponse({ promotion: r });
    }

    if (action === 'add-note') {
      const id = body.id as string;
      const note = body.note as string;
      if (!id || !note) return jsonResponse({ error: 'id and note required' }, 400);
      const r = await addNote(id, note, operatorId);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ strategy: r });
    }

    if (action === 'retire-strategy') {
      const r = await transitionStatus({
        strategyId: body.id,
        toStatus: 'retired',
        actor: operatorId,
        reason: body.reason ?? 'retired',
      });
      return jsonResponse({ strategy: r });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof TransitionError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'strategy_registry_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
