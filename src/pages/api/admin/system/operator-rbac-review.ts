import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  generateOperatorRbacReview,
  acknowledgeOperatorRbacReview,
  addOperatorRbacReviewNote,
  getOperatorRbacReview,
  getLatestOperatorRbacReview,
  listOperatorRbacReviews,
  getOperatorRbacReviewSummary,
  listKnownOperators,
  RbacReviewError,
} from '../../../../lib/operator-rbac-review';
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
    const action = url.searchParams.get('action') ?? 'summary';

    if (action === 'summary') {
      const data = await withTiming(
        'operator-rbac-review:summary',
        'quant-review',
        () => cached('operator-rbac-review:summary', async () => {
          const [summary, operators, reviews] = await Promise.all([
            getOperatorRbacReviewSummary(),
            listKnownOperators(),
            listOperatorRbacReviews(500),
          ]);
          return { summary, operators, reviews };
        }, 30_000),
      );
      return jsonResponse(data);
    }

    if (action === 'list-reviews') {
      const reviews = await listOperatorRbacReviews(500);
      return jsonResponse({ reviews });
    }

    if (action === 'get-review') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const r = await getOperatorRbacReview(id);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ review: r });
    }

    if (action === 'latest-for-operator') {
      const operatorId = url.searchParams.get('operatorId');
      if (!operatorId) return jsonResponse({ error: 'operatorId required' }, 400);
      const r = await getLatestOperatorRbacReview(operatorId);
      return jsonResponse({ review: r });
    }

    if (action === 'list-operators') {
      const ops = await listKnownOperators();
      return jsonResponse({ operators: ops });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'operator_rbac_review_failed', message: err?.message ?? String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const sessionCookie = await requireAdmin(request);
  if (!sessionCookie) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try { body = await request.json(); } catch { /* ignore */ }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(sessionCookie ?? '');
    if (!actor) return jsonResponse({ error: 'actor_required', message: 'No operator id resolved from session' }, 400);

    if (action === 'generate-review') {
      if (!body.operatorId) return jsonResponse({ error: 'operatorId required' }, 400);
      const r = await generateOperatorRbacReview(body.operatorId, actor);
      return jsonResponse({ review: r });
    }

    if (action === 'acknowledge-review') {
      if (!body.reviewId) return jsonResponse({ error: 'reviewId required' }, 400);
      const r = await acknowledgeOperatorRbacReview(body.reviewId, actor, body.note);
      return jsonResponse({ review: r });
    }

    if (action === 'add-note') {
      if (!body.reviewId) return jsonResponse({ error: 'reviewId required' }, 400);
      if (!body.note || !String(body.note).trim()) return jsonResponse({ error: 'note_required', message: 'note is required' }, 400);
      const r = await addOperatorRbacReviewNote(body.reviewId, actor, body.note);
      return jsonResponse({ review: r });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof RbacReviewError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'operator_rbac_review_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
