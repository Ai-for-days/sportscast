import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createDecision, getDecision, listDecisions, updateDecision, transitionDecision, addNote,
  computeSummary, DECISIONS, DECISION_STATUSES, RECOMMENDATIONS, DecisionError,
  type Decision, type DecisionStatus,
} from '../../../../lib/pilot-decision-tracker';
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
      const decisions = await listDecisions(500);
      return jsonResponse({
        decisions,
        decisionsEnum: DECISIONS,
        statuses: DECISION_STATUSES,
        recommendations: RECOMMENDATIONS,
      });
    }
    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const d = await getDecision(id);
      if (!d) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ decision: d });
    }
    if (action === 'summary') {
      const decisions = await withTiming(
        'pilot-decisions:summary',
        'quant-review',
        () => cached('pilot-decisions:list', () => listDecisions(2000), 30_000),
      );
      const summary = computeSummary(decisions);
      return jsonResponse({ summary, decisions });
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'pilot_decisions_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'create-decision') {
      const r = await createDecision({
        reviewId: body.reviewId,
        decision: body.decision as Decision,
        operatorId,
        rationale: body.rationale,
        plannedAction: body.plannedAction,
        dueDate: body.dueDate,
        linkedActions: body.linkedActions,
      });
      return jsonResponse({ decision: r });
    }

    if (action === 'update-decision') {
      const r = await updateDecision(body.id, {
        decision: body.decision as Decision | undefined,
        rationale: body.rationale,
        plannedAction: body.plannedAction,
        dueDate: body.dueDate,
        linkedActions: body.linkedActions,
      }, operatorId);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ decision: r });
    }

    if (action === 'mark-in-progress') {
      const r = await transitionDecision(body.id, 'in_progress', operatorId, body.note);
      return jsonResponse({ decision: r });
    }
    if (action === 'mark-completed') {
      const r = await transitionDecision(body.id, 'completed', operatorId, body.note);
      return jsonResponse({ decision: r });
    }
    if (action === 'cancel-decision') {
      const r = await transitionDecision(body.id, 'cancelled', operatorId, body.note ?? 'cancelled');
      return jsonResponse({ decision: r });
    }
    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const r = await addNote(body.id, body.note, operatorId);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ decision: r });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof DecisionError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'pilot_decisions_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
