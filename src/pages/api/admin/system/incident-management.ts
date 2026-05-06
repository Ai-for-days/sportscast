import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  createIncident,
  addTimelineEntry,
  changeStatus,
  resolveIncident,
  closeIncident,
  getIncident,
  listIncidents,
  listOpenIncidents,
  getIncidentSummary,
  IncidentError,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentCategory,
} from '../../../../lib/incident-management';

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
      const status = url.searchParams.get('status') as IncidentStatus | null;
      const severity = url.searchParams.get('severity') as IncidentSeverity | null;
      const category = url.searchParams.get('category') as IncidentCategory | null;
      const incidents = await listIncidents({
        limit,
        status: status ?? undefined,
        severity: severity ?? undefined,
        category: category ?? undefined,
      });
      return jsonResponse({ incidents });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const incident = await getIncident(id);
      if (!incident) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ incident });
    }

    if (action === 'open') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const incidents = await listOpenIncidents(limit);
      return jsonResponse({ incidents });
    }

    if (action === 'summary') {
      const [summary, open] = await Promise.all([getIncidentSummary(), listOpenIncidents(200)]);
      return jsonResponse({ summary, open });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'incident_management_failed', message: err?.message ?? String(err) }, 500);
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
      const incident = await createIncident({
        title: body.title,
        description: body.description,
        category: body.category,
        severity: body.severity,
        tags: body.tags,
        relatedWagerId: body.relatedWagerId,
        relatedOperatorId: body.relatedOperatorId,
        relatedIntegrityReportId: body.relatedIntegrityReportId,
        relatedSettlementPreviewId: body.relatedSettlementPreviewId,
        relatedCertificationId: body.relatedCertificationId,
        relatedRbacReviewId: body.relatedRbacReviewId,
        relatedRunbookDate: body.relatedRunbookDate,
        relatedEodReportDate: body.relatedEodReportDate,
        followUpActions: body.followUpActions,
        warnings: body.warnings,
      }, actor);
      return jsonResponse({ incident });
    }

    if (action === 'add-timeline-entry') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const incident = await addTimelineEntry(body.id, body.note, actor);
      return jsonResponse({ incident });
    }

    if (action === 'change-status') {
      if (!body.id || !body.to) return jsonResponse({ error: 'id and to required' }, 400);
      const incident = await changeStatus(body.id, body.to as IncidentStatus, actor, body.note);
      return jsonResponse({ incident });
    }

    if (action === 'resolve') {
      if (!body.id || !body.resolutionSummary) {
        return jsonResponse({ error: 'id and resolutionSummary required' }, 400);
      }
      const incident = await resolveIncident(body.id, actor, body.resolutionSummary);
      return jsonResponse({ incident });
    }

    if (action === 'close') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const incident = await closeIncident(body.id, actor, body.note);
      return jsonResponse({ incident });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof IncidentError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'incident_management_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
