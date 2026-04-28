import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  startPlaybook, getRun, listRuns, updateItem,
  linkCandidate, linkOrder, linkPilot,
  completePlaybook, cancelPlaybook, addNote,
  summarizeRuns, progressOf, blockersOf, pendingRequiredOf,
  ITEM_STATUSES, RUN_STATUSES, RUN_MODES, ITEM_CATEGORIES,
  type ItemStatus, type RunMode,
  PlaybookError,
} from '../../../../lib/execution-playbook';

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
      const runs = await listRuns(500);
      const enriched = runs.map(r => ({
        run: r,
        progress: progressOf(r),
        blockers: blockersOf(r).length,
        pendingRequired: pendingRequiredOf(r).length,
      }));
      return jsonResponse({
        runs: enriched,
        enums: {
          itemStatuses: ITEM_STATUSES,
          runStatuses: RUN_STATUSES,
          runModes: RUN_MODES,
          itemCategories: ITEM_CATEGORIES,
        },
      });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const r = await getRun(id);
      if (!r) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({
        run: r,
        progress: progressOf(r),
        blockers: blockersOf(r),
        pendingRequired: pendingRequiredOf(r),
      });
    }

    if (action === 'summary') {
      const runs = await listRuns(500);
      return jsonResponse({ summary: summarizeRuns(runs) });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'execution_playbook_failed', message: err?.message ?? String(err) }, 500);
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
    const operatorId = await getOperatorId(session ?? '');

    if (action === 'start-playbook') {
      const run = await startPlaybook({
        signalId: body.signalId,
        mode: body.mode as RunMode,
        operatorId,
        strategyId: body.strategyId,
        pilotId: body.pilotId,
        note: body.note,
      });
      return jsonResponse({ run });
    }

    if (action === 'update-item') {
      const run = await updateItem({
        runId: body.runId,
        itemId: body.itemId,
        status: body.status as ItemStatus,
        notes: body.notes,
        actor: operatorId,
      });
      return jsonResponse({ run });
    }

    if (action === 'link-candidate') {
      const run = await linkCandidate(body.runId, body.candidateId, operatorId);
      return jsonResponse({ run });
    }

    if (action === 'link-order') {
      const run = await linkOrder(body.runId, body.orderId, operatorId);
      return jsonResponse({ run });
    }

    if (action === 'link-pilot') {
      const run = await linkPilot(body.runId, body.pilotId, operatorId);
      return jsonResponse({ run });
    }

    if (action === 'complete-playbook') {
      const run = await completePlaybook(body.runId, operatorId);
      return jsonResponse({ run });
    }

    if (action === 'cancel-playbook') {
      const run = await cancelPlaybook(body.runId, operatorId, body.reason);
      return jsonResponse({ run });
    }

    if (action === 'add-note') {
      const run = await addNote(body.runId, body.note, operatorId);
      return jsonResponse({ run });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof PlaybookError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'execution_playbook_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
