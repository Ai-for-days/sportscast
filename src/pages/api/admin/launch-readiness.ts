import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { runAllReadinessChecks, summarizeChecks } from '../../../lib/production-readiness';
import {
  getChecklist, seedDefaultChecklist, completeChecklistItem, getChecklistProgress,
  requestLaunchSignoff, approveLaunchSignoff, rejectLaunchSignoff, listLaunchSignoffs,
  getLaunchState, updateLaunchState, getAllowedTransitions,
} from '../../../lib/go-live';
import { withTiming } from '../../../lib/performance-metrics';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'checks') {
      const { result: checks, durationMs } = await withTiming('/api/admin/launch-readiness?checks', 'launch', () => runAllReadinessChecks());
      const summary = summarizeChecks(checks);
      return new Response(JSON.stringify({ checks, summary, _meta: { durationMs } }), { status: 200 });
    }

    if (action === 'checklist') {
      const items = await getChecklist();
      const progress = getChecklistProgress(items);
      return new Response(JSON.stringify({ checklist: items, progress }), { status: 200 });
    }

    if (action === 'signoffs') {
      const signoffs = await listLaunchSignoffs();
      return new Response(JSON.stringify({ signoffs }), { status: 200 });
    }

    if (action === 'state') {
      const state = await getLaunchState();
      const allowed = getAllowedTransitions(state);
      return new Response(JSON.stringify({ state, allowedTransitions: allowed }), { status: 200 });
    }

    // Default: overview
    const { result: overview, durationMs } = await withTiming('/api/admin/launch-readiness?overview', 'launch', async () => {
      const [checks, checklist, signoffs, state] = await Promise.all([
        runAllReadinessChecks(),
        getChecklist(),
        listLaunchSignoffs(5),
        getLaunchState(),
      ]);
      const readinessSummary = summarizeChecks(checks);
      const progress = getChecklistProgress(checklist);
      const allowed = getAllowedTransitions(state);
      return { readinessSummary, checks, checklist, progress, signoffs, state, allowedTransitions: allowed };
    });

    return new Response(JSON.stringify({ ...overview, _meta: { durationMs } }), { status: 200 });
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
      case 'seed-default-checklist': {
        const count = await seedDefaultChecklist();
        return new Response(JSON.stringify({ ok: true, count, message: count > 0 ? `Seeded ${count} items` : 'Checklist already exists' }), { status: 200 });
      }

      case 'complete-checklist-item': {
        const item = await completeChecklistItem(body.itemKey, body.actor || 'admin', body.notes);
        if (!item) return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, item }), { status: 200 });
      }

      case 'request-launch-signoff': {
        const signoff = await requestLaunchSignoff(body.requestedBy || 'admin', body.notes);
        return new Response(JSON.stringify({ ok: true, signoff }), { status: 200 });
      }

      case 'approve-launch-signoff': {
        const signoff = await approveLaunchSignoff(body.id, body.approvedBy || 'admin', body.notes);
        if (!signoff) return new Response(JSON.stringify({ error: 'Signoff not found or self-approval blocked' }), { status: 400 });
        return new Response(JSON.stringify({ ok: true, signoff }), { status: 200 });
      }

      case 'reject-launch-signoff': {
        const signoff = await rejectLaunchSignoff(body.id, body.rejectedBy || 'admin', body.notes);
        if (!signoff) return new Response(JSON.stringify({ error: 'Signoff not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, signoff }), { status: 200 });
      }

      case 'update-launch-state': {
        const result = await updateLaunchState(body.state, body.actor || 'admin');
        if (!result.ok) return new Response(JSON.stringify({ error: result.error, state: result.state }), { status: 400 });
        return new Response(JSON.stringify({ ok: true, state: result.state }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
