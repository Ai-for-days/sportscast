import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  generateDraftReview, createReview, completeReview, addReviewNote,
  getReview, listReviews,
  REVIEW_TYPES, RECOMMENDATIONS, CONFIDENCES,
  type ReviewType, type Recommendation, type Confidence,
} from '../../../../lib/pilot-review';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

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
      const reviews = await listReviews(200);
      return jsonResponse({ reviews, types: REVIEW_TYPES, recommendations: RECOMMENDATIONS, confidences: CONFIDENCES });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const review = await getReview(id);
      if (!review) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ review });
    }

    if (action === 'generate-draft') {
      const pilotId = url.searchParams.get('pilotId');
      if (!pilotId) return jsonResponse({ error: 'pilotId required' }, 400);
      const draft = await withTiming(
        'pilot-review:draft',
        'quant-review',
        () => cached(`pilot-review-draft:${pilotId}`, () => generateDraftReview(pilotId), 30_000),
      );
      return jsonResponse({ draft });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'pilot_review_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'create-review') {
      if (!body.pilotId || !body.reviewType) return jsonResponse({ error: 'pilotId and reviewType required' }, 400);
      if (!REVIEW_TYPES.includes(body.reviewType)) return jsonResponse({ error: 'Invalid reviewType' }, 400);
      const review = await createReview({
        pilotId: body.pilotId,
        reviewType: body.reviewType as ReviewType,
        reviewer: operatorId,
        notes: body.notes,
      });
      return jsonResponse({ review });
    }

    if (action === 'complete-review') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      if (body.recommendation && !RECOMMENDATIONS.includes(body.recommendation)) return jsonResponse({ error: 'Invalid recommendation' }, 400);
      if (body.confidence && !CONFIDENCES.includes(body.confidence)) return jsonResponse({ error: 'Invalid confidence' }, 400);
      const review = await completeReview({
        id: body.id,
        reviewer: operatorId,
        recommendation: body.recommendation as Recommendation | undefined,
        confidence: body.confidence as Confidence | undefined,
        notes: body.notes,
        followUpActions: body.followUpActions,
      });
      if (!review) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ review });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const review = await addReviewNote(body.id, body.note, operatorId);
      if (!review) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ review });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'pilot_review_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
