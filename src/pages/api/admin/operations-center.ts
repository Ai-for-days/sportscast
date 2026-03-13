import type { APIRoute } from 'astro';
import { listIncidents, createIncident, updateIncident, addIncidentNote, getIncidentSummary } from '../../../lib/incidents';
import { listRunbooks, createRunbook, seedDefaultRunbooks } from '../../../lib/runbooks';
import { listHandoffs, createHandoff } from '../../../lib/handoffs';
import { listSignoffs, createSignoff, getTodaySignoffs, getMissingSignoffs, SIGNOFF_TYPES } from '../../../lib/signoff';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'incidents') {
      const incidents = await listIncidents();
      const summary = await getIncidentSummary();
      return new Response(JSON.stringify({ incidents, summary }), { status: 200 });
    }

    if (action === 'runbooks') {
      const runbooks = await listRunbooks();
      return new Response(JSON.stringify({ runbooks }), { status: 200 });
    }

    if (action === 'handoffs') {
      const handoffs = await listHandoffs();
      return new Response(JSON.stringify({ handoffs }), { status: 200 });
    }

    if (action === 'signoffs') {
      const signoffs = await listSignoffs();
      const todaySignoffs = await getTodaySignoffs();
      const missing = await getMissingSignoffs();
      return new Response(JSON.stringify({ signoffs, todaySignoffs, missing, signoffTypes: SIGNOFF_TYPES }), { status: 200 });
    }

    // Default: overview — aggregate summary for command center
    const [incidentSummary, incidents, runbooks, handoffs, todaySignoffs, missing] = await Promise.all([
      getIncidentSummary(),
      listIncidents(),
      listRunbooks(),
      listHandoffs(5),
      getTodaySignoffs(),
      getMissingSignoffs(),
    ]);

    const activeIncidents = incidents.filter(i => i.status !== 'closed' && i.status !== 'resolved');

    return new Response(JSON.stringify({
      incidentSummary,
      activeIncidents,
      runbookCount: runbooks.length,
      recentHandoffs: handoffs,
      todaySignoffs,
      missingSignoffs: missing,
      signoffTypes: SIGNOFF_TYPES,
    }), { status: 200 });
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
