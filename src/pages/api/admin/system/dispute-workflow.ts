import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createDispute,
  addNote,
  changeStatus,
  makeRecommendation,
  resolveDispute,
  closeDispute,
  getDispute,
  listDisputes,
  listOpenDisputes,
  listDisputesForWager,
  getDisputeSummary,
  DisputeError,
  type DisputeSeverity,
  type DisputeStatus,
  type DisputeCategory,
  type RecommendedResolution,
} from '../../../../lib/dispute-workflow';

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
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const status = url.searchParams.get('status') as DisputeStatus | null;
      const severity = url.searchParams.get('severity') as DisputeSeverity | null;
      const category = url.searchParams.get('category') as DisputeCategory | null;
      const disputes = await listDisputes({
        limit,
        status: status ?? undefined,
        severity: severity ?? undefined,
        category: category ?? undefined,
      });
      return jsonResponse({ disputes });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const dispute = await getDispute(id);
      if (!dispute) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ dispute });
    }

    if (action === 'open') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const disputes = await listOpenDisputes(limit);
      return jsonResponse({ disputes });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const disputes = await listDisputesForWager(wagerId);
      return jsonResponse({ disputes });
    }

    if (action === 'summary') {
      const [summary, open] = await Promise.all([getDisputeSummary(), listOpenDisputes(200)]);
      return jsonResponse({ summary, open });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'dispute_workflow_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'create') {
      const dispute = await createDispute({
        title: body.title,
        description: body.description,
        category: body.category,
        severity: body.severity,
        relatedWagerId: body.relatedWagerId,
        relatedEvidenceId: body.relatedEvidenceId,
        relatedIncidentId: body.relatedIncidentId,
        relatedSettlementPreviewId: body.relatedSettlementPreviewId,
        claimantType: body.claimantType,
        claimantReference: body.claimantReference,
        requestedOutcome: body.requestedOutcome,
        currentOutcome: body.currentOutcome,
      }, actor);
      return jsonResponse({ dispute });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const dispute = await addNote(body.id, body.note, actor);
      return jsonResponse({ dispute });
    }

    if (action === 'change-status') {
      if (!body.id || !body.to) return jsonResponse({ error: 'id and to required' }, 400);
      const dispute = await changeStatus(body.id, body.to as DisputeStatus, actor, body.note);
      return jsonResponse({ dispute });
    }

    if (action === 'make-recommendation') {
      if (!body.id || !body.recommendedResolution || !body.rationale) {
        return jsonResponse({ error: 'id, recommendedResolution, and rationale required' }, 400);
      }
      const dispute = await makeRecommendation({
        id: body.id,
        recommendedResolution: body.recommendedResolution as RecommendedResolution,
        rationale: body.rationale,
        actor,
      });
      return jsonResponse({ dispute });
    }

    if (action === 'resolve') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const dispute = await resolveDispute(body.id, actor, body.note);
      return jsonResponse({ dispute });
    }

    if (action === 'close') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const dispute = await closeDispute(body.id, actor, body.note);
      return jsonResponse({ dispute });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof DisputeError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'dispute_workflow_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
