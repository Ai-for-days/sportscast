import type { APIRoute } from 'astro';
import {
  listDrills, getDrill, startDrill, cancelDrill, addDrillNote,
  getDrillSummary, SCENARIOS,
} from '../../../lib/resilience';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'drills') {
      const drills = await listDrills();
      return new Response(JSON.stringify({ drills }), { status: 200 });
    }

    if (action === 'get-drill') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const drill = await getDrill(id);
      if (!drill) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify({ drill }), { status: 200 });
    }

    if (action === 'scenarios') {
      return new Response(JSON.stringify({ scenarios: SCENARIOS }), { status: 200 });
    }

    // Default: overview
    const [summary, drills] = await Promise.all([
      getDrillSummary(),
      listDrills(20),
    ]);

    return new Response(JSON.stringify({ summary, drills, scenarios: SCENARIOS }), { status: 200 });
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
      case 'run-drill': {
        const drill = await startDrill({
          scenarioType: body.scenarioType,
          initiatedBy: body.initiatedBy || 'admin',
          parameters: body.parameters,
          expectedOutcome: body.expectedOutcome,
        });
        return new Response(JSON.stringify({ ok: true, drill }), { status: 200 });
      }

      case 'cancel-drill': {
        const drill = await cancelDrill(body.id);
        if (!drill) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, drill }), { status: 200 });
      }

      case 'add-drill-note': {
        const drill = await addDrillNote(body.id, body.note);
        if (!drill) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, drill }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
