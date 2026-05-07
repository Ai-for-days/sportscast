// ── Step 119B Part B: Admin API for Manual Hedge Review ─────────────────────
//
// Advisory ledger only. No Kalshi orders. No external execution. Audit-
// logged for every mutation. Status transitions validated server-side.

import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import { logAuditEvent } from '../../../../lib/audit-log';
import {
  createHedgeReview,
  addDecisionNote,
  changeReviewStatus,
  closeReview,
  listHedgeReviews,
  getHedgeReview,
  getHedgeReviewsByWager,
  getHedgeReviewSummary,
  HedgeReviewError,
  type HedgeReview,
  type HedgeReviewStatus,
} from '../../../../lib/manual-hedge-review';

export const prerender = false;

const STATUS_VALUES: HedgeReviewStatus[] = [
  'draft',
  'under_review',
  'hedge_recommended',
  'no_hedge_recommended',
  'manually_hedged_elsewhere',
  'closed',
];

function isStatus(s: unknown): s is HedgeReviewStatus {
  return typeof s === 'string' && (STATUS_VALUES as string[]).includes(s);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(200, Math.max(1, Number(limitRaw) || 50)) : 50;
      const reviews = await listHedgeReviews(limit);
      return jsonResponse({ reviews });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const review = await getHedgeReview(id);
      if (!review) return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ review });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const reviews = await getHedgeReviewsByWager(wagerId);
      return jsonResponse({ reviews });
    }

    if (action === 'summary') {
      const summary = await getHedgeReviewSummary();
      return jsonResponse({ summary });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      { error: 'manual_hedge_review_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  const action = body.action as string | undefined;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  try {
    const actor = await getOperatorId(session ?? '');
    if (!actor) {
      return jsonResponse(
        { error: 'actor_required', message: 'No operator id resolved from session' },
        400,
      );
    }

    if (action === 'create') {
      let review: HedgeReview;
      try {
        review = await createHedgeReview(
          {
            wagerId: typeof body.wagerId === 'string' ? body.wagerId : '',
            comparisonId:
              typeof body.comparisonId === 'string' && body.comparisonId.trim()
                ? body.comparisonId.trim()
                : undefined,
          },
          actor,
        );
      } catch (err: any) {
        if (err instanceof HedgeReviewError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'manual_hedge_review_created',
        targetType: 'hedge_review',
        targetId: review.id,
        summary: `Created hedge review for wager ${review.relatedWagerId}: recommended ${review.recommendedAction}.`,
        details: {
          wagerId: review.relatedWagerId,
          recommendedAction: review.recommendedAction,
          relatedKalshiComparisonId: review.relatedKalshiComparisonId,
          relatedHouseExposureSnapshotId: review.relatedHouseExposureSnapshotId,
        },
      });
      return jsonResponse({ review });
    }

    if (action === 'add-decision-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      let review: HedgeReview;
      try {
        review = await addDecisionNote(String(body.id), String(body.note), actor);
      } catch (err: any) {
        if (err instanceof HedgeReviewError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'manual_hedge_review_note_added',
        targetType: 'hedge_review',
        targetId: review.id,
        summary: `Added decision note to hedge review ${review.id}.`,
        details: { note: String(body.note).slice(0, 500) },
      });
      return jsonResponse({ review });
    }

    if (action === 'change-status') {
      if (!body.id || !isStatus(body.to)) {
        return jsonResponse({ error: 'id and valid status required' }, 400);
      }
      let review: HedgeReview;
      try {
        review = await changeReviewStatus(
          String(body.id),
          body.to,
          actor,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
      } catch (err: any) {
        if (err instanceof HedgeReviewError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'manual_hedge_review_status_changed',
        targetType: 'hedge_review',
        targetId: review.id,
        summary: `Hedge review ${review.id} status → ${review.status}.`,
        details: { to: review.status, reason: body.reason },
      });
      return jsonResponse({ review });
    }

    if (action === 'close') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      let review: HedgeReview;
      try {
        review = await closeReview(
          String(body.id),
          actor,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
      } catch (err: any) {
        if (err instanceof HedgeReviewError) {
          return jsonResponse({ error: err.code, message: err.message }, 400);
        }
        throw err;
      }
      await logAuditEvent({
        actor,
        eventType: 'manual_hedge_review_closed',
        targetType: 'hedge_review',
        targetId: review.id,
        summary: `Closed hedge review ${review.id}.`,
        details: typeof body.reason === 'string' ? { reason: body.reason } : undefined,
      });
      return jsonResponse({ review });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse(
      {
        error: 'manual_hedge_review_action_failed',
        message: err?.message ?? String(err),
      },
      500,
    );
  }
};
