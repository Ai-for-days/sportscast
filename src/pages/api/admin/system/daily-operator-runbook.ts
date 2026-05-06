import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createOrLoadToday,
  getRunbook,
  listRunbooks,
  updateItem,
  addNote,
  completeRunbook,
  progressOf,
  RunbookError,
  type ItemStatus,
} from '../../../../lib/daily-operator-runbook';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'today';

    if (action === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      const runbook = await getRunbook(today);
      return jsonResponse({ date: today, runbook, progress: runbook ? progressOf(runbook) : null });
    }

    if (action === 'get') {
      const date = url.searchParams.get('date');
      if (!date) return jsonResponse({ error: 'date required' }, 400);
      const runbook = await getRunbook(date);
      if (!runbook) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ runbook, progress: progressOf(runbook) });
    }

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(365, Math.max(1, Number(limitRaw) || 60)) : 60;
      const runbooks = await listRunbooks(limit);
      return jsonResponse({
        runbooks: runbooks.map(rb => ({ runbook: rb, progress: progressOf(rb) })),
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'daily_runbook_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'create-or-load-today') {
      const rb = await createOrLoadToday(actor);
      return jsonResponse({ runbook: rb, progress: progressOf(rb) });
    }

    if (action === 'update-item') {
      if (!body.date || !body.itemId || !body.status) {
        return jsonResponse({ error: 'date, itemId, status required' }, 400);
      }
      const rb = await updateItem({
        date: body.date,
        itemId: body.itemId,
        status: body.status as ItemStatus,
        note: body.note,
        actor,
      });
      return jsonResponse({ runbook: rb, progress: progressOf(rb) });
    }

    if (action === 'add-note') {
      if (!body.date || !body.note) return jsonResponse({ error: 'date and note required' }, 400);
      const rb = await addNote(body.date, body.note, actor);
      return jsonResponse({ runbook: rb, progress: progressOf(rb) });
    }

    if (action === 'complete-runbook') {
      if (!body.date) return jsonResponse({ error: 'date required' }, 400);
      const rb = await completeRunbook(body.date, actor);
      return jsonResponse({ runbook: rb, progress: progressOf(rb) });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof RunbookError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'daily_runbook_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
