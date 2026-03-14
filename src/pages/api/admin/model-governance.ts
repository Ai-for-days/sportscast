import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  listModelVersions,
  getActiveVersions,
  createModelVersion,
  promoteVersion,
  archiveVersion,
  initializeDefaults,
  MODEL_FAMILIES,
} from '../../../lib/model-registry';
import {
  listExperiments,
  createExperiment,
  updateExperimentStatus,
} from '../../../lib/experiments';
import { compareModels } from '../../../lib/model-comparison';
import { logAuditEvent } from '../../../lib/audit-log';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action');

    // Compare two model versions
    if (action === 'compare') {
      const baselineId = url.searchParams.get('baselineId') || '';
      const candidateId = url.searchParams.get('candidateId') || '';
      if (!baselineId || !candidateId) {
        return new Response(JSON.stringify({ error: 'baselineId and candidateId required' }), { status: 400 });
      }
      const result = await compareModels(baselineId, candidateId);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Default: return everything
    const [versions, activeVersions, experiments] = await Promise.all([
      listModelVersions(),
      getActiveVersions(),
      listExperiments(),
    ]);

    return new Response(JSON.stringify({
      versions,
      activeVersions,
      experiments,
      families: MODEL_FAMILIES,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/* ------------------------------------------------------------------ */
/*  POST                                                                */
/* ------------------------------------------------------------------ */

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'create-model-version': {
        const { family, version, name, description, parameters, notes } = body;
        if (!family || !version || !name) {
          return new Response(JSON.stringify({ error: 'family, version, and name required' }), { status: 400 });
        }
        const model = await createModelVersion({ family, version, name, description, parameters, notes });
        return new Response(JSON.stringify({ ok: true, model }), { status: 200 });
      }

      case 'promote-model-version': {
        const { id } = body;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
        const model = await promoteVersion(id);
        if (!model) return new Response(JSON.stringify({ error: 'Version not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, model }), { status: 200 });
      }

      case 'archive-model-version': {
        const { id } = body;
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
        const model = await archiveVersion(id);
        if (!model) return new Response(JSON.stringify({ error: 'Version not found or is active' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, model }), { status: 200 });
      }

      case 'create-experiment': {
        const { family, name, description, baselineVersion, candidateVersion, notes } = body;
        if (!family || !name || !baselineVersion || !candidateVersion) {
          return new Response(JSON.stringify({ error: 'family, name, baselineVersion, candidateVersion required' }), { status: 400 });
        }
        const exp = await createExperiment({ family, name, description, baselineVersion, candidateVersion, notes });
        return new Response(JSON.stringify({ ok: true, experiment: exp }), { status: 200 });
      }

      case 'update-experiment-status': {
        const { id, status, results, notes } = body;
        if (!id || !status) return new Response(JSON.stringify({ error: 'id and status required' }), { status: 400 });
        const exp = await updateExperimentStatus(id, status, results, notes);
        if (!exp) return new Response(JSON.stringify({ error: 'Experiment not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, experiment: exp }), { status: 200 });
      }

      case 'initialize-defaults': {
        await initializeDefaults();
        await logAuditEvent({
          actor: 'admin',
          eventType: 'model_defaults_initialized',
          targetType: 'system',
          targetId: 'model-registry',
          summary: 'Model registry defaults initialized',
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
