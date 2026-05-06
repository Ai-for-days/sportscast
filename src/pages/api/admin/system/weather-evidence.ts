import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createManualEvidence,
  addEvidenceNote,
  linkToWager,
  getEvidence,
  listEvidence,
  listEvidenceForWager,
  getEvidenceSummary,
  WeatherEvidenceError,
} from '../../../../lib/weather-evidence';

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
      const records = await listEvidence(limit);
      return jsonResponse({ records });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const record = await getEvidence(id);
      if (!record) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ record });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const records = await listEvidenceForWager(wagerId);
      return jsonResponse({ records });
    }

    if (action === 'summary') {
      const [summary, records] = await Promise.all([
        getEvidenceSummary(),
        listEvidence(200),
      ]);
      return jsonResponse({ summary, records });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'weather_evidence_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'create-manual-evidence') {
      const record = await createManualEvidence({
        wagerId: body.wagerId,
        location: body.location,
        metric: body.metric,
        targetDate: body.targetDate,
        targetTime: body.targetTime,
        sources: body.sources ?? [],
        notes: body.notes ?? [],
      }, actor);
      return jsonResponse({ record });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const record = await addEvidenceNote(body.id, body.note, actor);
      return jsonResponse({ record });
    }

    if (action === 'link-to-wager') {
      if (!body.id || !body.wagerId) return jsonResponse({ error: 'id and wagerId required' }, 400);
      const record = await linkToWager(body.id, body.wagerId, actor);
      return jsonResponse({ record });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof WeatherEvidenceError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'weather_evidence_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
