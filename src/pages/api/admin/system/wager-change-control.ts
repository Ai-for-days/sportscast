import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createChangeRequest,
  submitForReview,
  addChangeNote,
  approveChange,
  rejectChange,
  withdrawChange,
  markImplementedManually,
  closeChange,
  moveToUnderReview,
  getChange,
  listChanges,
  listOpenChanges,
  listChangesForWager,
  getChangeSummary,
  ChangeControlError,
  type ChangeStatus,
  type ChangeSeverity,
  type ChangeType,
} from '../../../../lib/wager-change-control';

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
      const status = url.searchParams.get('status') as ChangeStatus | null;
      const severity = url.searchParams.get('severity') as ChangeSeverity | null;
      const changeType = url.searchParams.get('changeType') as ChangeType | null;
      const requests = await listChanges({
        limit,
        status: status ?? undefined,
        severity: severity ?? undefined,
        changeType: changeType ?? undefined,
      });
      return jsonResponse({ requests });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const request = await getChange(id);
      if (!request) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ request });
    }

    if (action === 'open') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const requests = await listOpenChanges(limit);
      return jsonResponse({ requests });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const requests = await listChangesForWager(wagerId);
      return jsonResponse({ requests });
    }

    if (action === 'summary') {
      const [summary, open] = await Promise.all([getChangeSummary(), listOpenChanges(200)]);
      return jsonResponse({ summary, open });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'wager_change_control_failed', message: err?.message ?? String(err) }, 500);
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
      const req = await createChangeRequest({
        relatedWagerId: body.relatedWagerId,
        changeType: body.changeType,
        severity: body.severity,
        requestedChangeSummary: body.requestedChangeSummary,
        rationale: body.rationale,
        currentStateSnapshot: body.currentStateSnapshot,
        proposedStateSnapshot: body.proposedStateSnapshot,
        riskAssessment: body.riskAssessment,
        relatedIncidentId: body.relatedIncidentId,
        relatedDisputeId: body.relatedDisputeId,
        relatedEvidenceId: body.relatedEvidenceId,
      }, actor);
      return jsonResponse({ request: req });
    }

    if (action === 'submit') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const req = await submitForReview(body.id, actor, body.note);
      return jsonResponse({ request: req });
    }

    if (action === 'move-to-under-review') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const req = await moveToUnderReview(body.id, actor, body.note);
      return jsonResponse({ request: req });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const req = await addChangeNote(body.id, body.note, actor);
      return jsonResponse({ request: req });
    }

    if (action === 'approve') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const req = await approveChange(body.id, actor, body.note);
      return jsonResponse({ request: req });
    }

    if (action === 'reject') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required (rejection requires a written reason)' }, 400);
      const req = await rejectChange(body.id, actor, body.note);
      return jsonResponse({ request: req });
    }

    if (action === 'withdraw') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const req = await withdrawChange(body.id, actor, body.note);
      return jsonResponse({ request: req });
    }

    if (action === 'mark-implemented-manually') {
      if (!body.id || !body.implementationNote) {
        return jsonResponse({ error: 'id and implementationNote required' }, 400);
      }
      const req = await markImplementedManually(body.id, actor, body.implementationNote);
      return jsonResponse({ request: req });
    }

    if (action === 'close') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const req = await closeChange(body.id, actor, body.note);
      return jsonResponse({ request: req });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof ChangeControlError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'wager_change_control_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
