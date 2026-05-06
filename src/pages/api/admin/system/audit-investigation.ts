import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  searchTimeline,
  objectHistory,
  buildRelatedObjects,
  saveInvestigation,
  listInvestigations,
  getInvestigation,
  addInvestigationNote,
  AuditInvestigationError,
  type InvestigationFilters,
  type ObjectHistoryKind,
  type SeverityClass,
  type Subsystem,
} from '../../../../lib/audit-investigation';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function readFilters(url: URL): InvestigationFilters {
  return {
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    actor: url.searchParams.get('actor') ?? undefined,
    wagerId: url.searchParams.get('wagerId') ?? undefined,
    userId: url.searchParams.get('userId') ?? undefined,
    severity: (url.searchParams.get('severity') as SeverityClass | null) ?? undefined,
    eventType: url.searchParams.get('eventType') ?? undefined,
    subsystem: (url.searchParams.get('subsystem') as Subsystem | null) ?? undefined,
  };
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'timeline';

    if (action === 'timeline' || action === 'search') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const filters = readFilters(url);
      const [timeline, related] = await Promise.all([
        searchTimeline(filters, limit),
        buildRelatedObjects(filters),
      ]);
      return jsonResponse({ filters, timeline, relatedObjects: related });
    }

    if (action === 'object-history') {
      const kind = url.searchParams.get('kind') as ObjectHistoryKind | null;
      const id = url.searchParams.get('id');
      if (!kind || !id) return jsonResponse({ error: 'kind and id required' }, 400);
      const history = await objectHistory(kind, id);
      return jsonResponse({ history });
    }

    if (action === 'list-investigations') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 100)) : 100;
      const investigations = await listInvestigations(limit);
      return jsonResponse({ investigations });
    }

    if (action === 'get-investigation') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const investigation = await getInvestigation(id);
      if (!investigation) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ investigation });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'audit_investigation_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'save-investigation') {
      const investigation = await saveInvestigation({
        title: body.title,
        filters: body.filters ?? {},
        timeline: body.timeline,
        notes: body.notes,
      }, actor);
      return jsonResponse({ investigation });
    }

    if (action === 'add-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const investigation = await addInvestigationNote(body.id, body.note, actor);
      return jsonResponse({ investigation });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof AuditInvestigationError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'audit_investigation_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
