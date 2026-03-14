import type { APIRoute } from 'astro';
import { listIncidents, createIncident, updateIncident, addIncidentNote, getIncidentSummary } from '../../../lib/incidents';
import { listRunbooks, createRunbook, seedDefaultRunbooks } from '../../../lib/runbooks';
import { listHandoffs, createHandoff } from '../../../lib/handoffs';
import { listSignoffs, createSignoff, getTodaySignoffs, getMissingSignoffs, SIGNOFF_TYPES } from '../../../lib/signoff';
import { cached } from '../../../lib/performance-cache';
import { withTiming } from '../../../lib/performance-metrics';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'incidents') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result, durationMs } = await withTiming('/api/admin/operations-center?incidents', 'ops-center', async () => {
        const incidents = await listIncidents(limit);
        const summary = await getIncidentSummary();
        return { incidents, summary };
      });
      return new Response(JSON.stringify({ ...result, _meta: { count: result.incidents.length, limit, durationMs } }), { status: 200 });
    }

    if (action === 'runbooks') {
      const { result: runbooks, durationMs } = await withTiming('/api/admin/operations-center?runbooks', 'ops-center', () => listRunbooks());
      return new Response(JSON.stringify({ runbooks, _meta: { count: runbooks.length, durationMs } }), { status: 200 });
    }

    if (action === 'handoffs') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: handoffs, durationMs } = await withTiming('/api/admin/operations-center?handoffs', 'ops-center', () => listHandoffs(limit));
      return new Response(JSON.stringify({ handoffs, _meta: { count: handoffs.length, limit, durationMs } }), { status: 200 });
    }

    if (action === 'signoffs') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result, durationMs } = await withTiming('/api/admin/operations-center?signoffs', 'ops-center', async () => {
        const signoffs = await listSignoffs(limit);
        const todaySignoffs = await getTodaySignoffs();
        const missing = await getMissingSignoffs();
        return { signoffs, todaySignoffs, missing, signoffTypes: SIGNOFF_TYPES };
      });
      return new Response(JSON.stringify({ ...result, _meta: { durationMs } }), { status: 200 });
    }

    // Default: overview (cached)
    const { result: overview, durationMs } = await withTiming('/api/admin/operations-center?overview', 'ops-center', () =>
      cached('ops-center:overview', async () => {
        const [incidentSummary, incidents, runbooks, handoffs, todaySignoffs, missing] = await Promise.all([
          getIncidentSummary(),
          listIncidents(),
          listRunbooks(),
          listHandoffs(5),
          getTodaySignoffs(),
          getMissingSignoffs(),
        ]);
        const activeIncidents = incidents.filter(i => i.status !== 'closed' && i.status !== 'resolved');
        return {
          incidentSummary,
          activeIncidents,
          runbookCount: runbooks.length,
          recentHandoffs: handoffs,
          todaySignoffs,
          missingSignoffs: missing,
          signoffTypes: SIGNOFF_TYPES,
        };
      }, 30_000)
    );

    return new Response(JSON.stringify({ ...overview, _meta: { durationMs, cached: true } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'create-incident': {
        const inc = await createIncident({
          title: body.title,
          severity: body.severity,
          category: body.category,
          description: body.description,
          owner: body.owner,
          sourceAlertId: body.sourceAlertId,
          linkedRunbookId: body.linkedRunbookId,
          linkedPages: body.linkedPages,
        });
        return new Response(JSON.stringify({ ok: true, incident: inc }), { status: 200 });
      }

      case 'update-incident': {
        const inc = await updateIncident(body.id, {
          status: body.status,
          severity: body.severity,
          owner: body.owner,
          linkedRunbookId: body.linkedRunbookId,
        });
        if (!inc) return new Response(JSON.stringify({ error: 'Incident not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, incident: inc }), { status: 200 });
      }

      case 'add-incident-note': {
        const inc = await addIncidentNote(body.id, body.note);
        if (!inc) return new Response(JSON.stringify({ error: 'Incident not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, incident: inc }), { status: 200 });
      }

      case 'create-runbook': {
        const rb = await createRunbook({
          title: body.title,
          category: body.category,
          steps: body.steps,
          severity: body.severity,
          linkedAlertTypes: body.linkedAlertTypes,
          linkedPages: body.linkedPages,
        });
        return new Response(JSON.stringify({ ok: true, runbook: rb }), { status: 200 });
      }

      case 'seed-runbooks': {
        const count = await seedDefaultRunbooks();
        return new Response(JSON.stringify({ ok: true, count, message: count > 0 ? `Seeded ${count} runbooks` : 'Runbooks already exist' }), { status: 200 });
      }

      case 'create-handoff': {
        const h = await createHandoff({
          operator: body.operator,
          summary: body.summary,
          openIssues: body.openIssues || [],
          priorityItems: body.priorityItems || [],
          pnlSummary: body.pnlSummary,
          riskSummary: body.riskSummary,
          notes: body.notes,
        });
        return new Response(JSON.stringify({ ok: true, handoff: h }), { status: 200 });
      }

      case 'create-signoff': {
        const s = await createSignoff({
          signoffType: body.signoffType,
          actor: body.actor || 'admin',
          notes: body.notes,
        });
        return new Response(JSON.stringify({ ok: true, signoff: s }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
