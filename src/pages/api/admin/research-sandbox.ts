import type { APIRoute } from 'astro';
import {
  runScenario,
  saveScenarioRun,
  listSandboxRuns,
  getSandboxRun,
  resultToCSV,
  SCENARIO_TYPES,
} from '../../../lib/research-sandbox';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action');

    if (action === 'get-run') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const run = await getSandboxRun(id);
      if (!run) return new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 });
      return new Response(JSON.stringify(run), { status: 200 });
    }

    if (action === 'export-csv') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const run = await getSandboxRun(id);
      if (!run) return new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 });
      const csv = resultToCSV(run.results);
      return new Response(csv, {
        status: 200,
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="sandbox-${run.id}.csv"` },
      });
    }

    if (action === 'export-json') {
      const id = url.searchParams.get('id') || '';
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
      const run = await getSandboxRun(id);
      if (!run) return new Response(JSON.stringify({ error: 'Run not found' }), { status: 404 });
      return new Response(JSON.stringify(run, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="sandbox-${run.id}.json"` },
      });
    }

    // Default: list runs + scenario types
    const runs = await listSandboxRuns();
    return new Response(JSON.stringify({ runs, scenarioTypes: SCENARIO_TYPES }), { status: 200 });
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
      case 'run-scenario': {
        const { scenarioType, inputs } = body;
        if (!scenarioType || !inputs) {
          return new Response(JSON.stringify({ error: 'scenarioType and inputs required' }), { status: 400 });
        }
        const results = await runScenario(scenarioType, inputs);
        return new Response(JSON.stringify({ ok: true, results }), { status: 200 });
      }

      case 'save-run': {
        const { name, scenarioType, inputs, results, description, experimentId } = body;
        if (!name || !scenarioType || !inputs || !results) {
          return new Response(JSON.stringify({ error: 'name, scenarioType, inputs, results required' }), { status: 400 });
        }
        const run = await saveScenarioRun(name, scenarioType, inputs, results, description, experimentId);
        return new Response(JSON.stringify({ ok: true, run }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
