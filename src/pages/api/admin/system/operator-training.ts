import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  listScenarios, getScenario,
  startSession, getSession, listSessions, recordAction,
  completeSession, cancelSession, addNote,
  summarizeSessions,
  TrainingError,
} from '../../../../lib/operator-training';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'list';

    if (action === 'list-scenarios') {
      return jsonResponse({ scenarios: listScenarios() });
    }

    if (action === 'get-scenario') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const s = getScenario(id);
      if (!s) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ scenario: s });
    }

    if (action === 'list' || action === 'list-sessions') {
      const sessions = await listSessions(500);
      return jsonResponse({
        scenarios: listScenarios(),
        sessions,
        summary: summarizeSessions(sessions),
      });
    }

    if (action === 'get-session') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const s = await getSession(id);
      if (!s) return jsonResponse({ error: 'not found' }, 404);
      const scenario = getScenario(s.scenarioId);
      return jsonResponse({ session: s, scenario });
    }

    if (action === 'summary') {
      const sessions = await listSessions(500);
      return jsonResponse({ summary: summarizeSessions(sessions) });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'operator_training_failed', message: err?.message ?? String(err) }, 500);
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
    const operatorId = await getOperatorId(sessionCookie ?? '');

    if (action === 'start-session') {
      const s = await startSession({ operatorId, scenarioId: body.scenarioId, note: body.note });
      const scenario = getScenario(s.scenarioId);
      return jsonResponse({ session: s, scenario });
    }

    if (action === 'record-action') {
      const s = await recordAction({
        sessionId: body.sessionId,
        actionId: body.actionId ?? null,
        note: body.note,
        actor: operatorId,
      });
      return jsonResponse({ session: s });
    }

    if (action === 'complete-session') {
      const s = await completeSession(body.sessionId, operatorId);
      return jsonResponse({ session: s });
    }

    if (action === 'cancel-session') {
      const s = await cancelSession(body.sessionId, operatorId, body.reason);
      return jsonResponse({ session: s });
    }

    if (action === 'add-note') {
      const s = await addNote(body.sessionId, body.note, operatorId);
      return jsonResponse({ session: s });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof TrainingError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'operator_training_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
