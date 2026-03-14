import type { APIRoute } from 'astro';
import {
  listChangeRequests, createChangeRequest, updateChangeRequestStatus,
  addChangeRequestNote, linkChangeToRelease, getChangeRequestSummary,
} from '../../../lib/change-management';
import { listReleases, createRelease, updateReleaseStatus, addChangeToRelease } from '../../../lib/releases';
import { listStructuredChanges, recordStructuredChange } from '../../../lib/structured-changes';
import { cached } from '../../../lib/performance-cache';
import { withTiming } from '../../../lib/performance-metrics';

/* ------------------------------------------------------------------ */
/*  GET                                                                 */
/* ------------------------------------------------------------------ */

export const GET: APIRoute = async ({ url }) => {
  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'changes') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: changes, durationMs } = await withTiming('/api/admin/change-control?changes', 'change-control', () => listChangeRequests(limit));
      return new Response(JSON.stringify({ changes, _meta: { count: changes.length, limit, durationMs } }), { status: 200 });
    }
    if (action === 'releases') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: releases, durationMs } = await withTiming('/api/admin/change-control?releases', 'change-control', () => listReleases(limit));
      return new Response(JSON.stringify({ releases, _meta: { count: releases.length, limit, durationMs } }), { status: 200 });
    }
    if (action === 'structured') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { result: structured, durationMs } = await withTiming('/api/admin/change-control?structured', 'change-control', () => listStructuredChanges(limit));
      return new Response(JSON.stringify({ structured, _meta: { count: structured.length, limit, durationMs } }), { status: 200 });
    }

    // Default: overview (cached)
    const { result: overview, durationMs } = await withTiming('/api/admin/change-control?overview', 'change-control', () =>
      cached('change-control:overview', async () => {
        const [summary, changes, releases, structured] = await Promise.all([
          getChangeRequestSummary(),
          listChangeRequests(50),
          listReleases(20),
          listStructuredChanges(30),
        ]);
        const today = new Date().toISOString().slice(0, 10);
        const changesToday = structured.filter(s => s.createdAt.startsWith(today)).length;
        return { summary, changes, releases, structured, changesToday };
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
      case 'create-change-request': {
        const cr = await createChangeRequest({
          title: body.title,
          category: body.category,
          severity: body.severity,
          requestedBy: body.requestedBy || 'admin',
          description: body.description,
          changeSummary: body.changeSummary,
          rollbackPlan: body.rollbackPlan,
        });
        return new Response(JSON.stringify({ ok: true, change: cr }), { status: 200 });
      }

      case 'update-change-request-status': {
        const cr = await updateChangeRequestStatus(body.id, body.status, body.actor || 'admin');
        if (!cr) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, change: cr }), { status: 200 });
      }

      case 'add-change-request-note': {
        const cr = await addChangeRequestNote(body.id, body.note);
        if (!cr) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, change: cr }), { status: 200 });
      }

      case 'link-change-to-release': {
        const cr = await linkChangeToRelease(body.changeId, body.releaseId);
        if (!cr) return new Response(JSON.stringify({ error: 'Change not found' }), { status: 404 });
        const rel = await addChangeToRelease(body.releaseId, body.changeId);
        return new Response(JSON.stringify({ ok: true, change: cr, release: rel }), { status: 200 });
      }

      case 'create-release': {
        const rel = await createRelease({
          versionLabel: body.versionLabel,
          title: body.title,
          summary: body.summary,
          relatedChangeIds: body.relatedChangeIds,
          notes: body.notes,
        });
        return new Response(JSON.stringify({ ok: true, release: rel }), { status: 200 });
      }

      case 'update-release-status': {
        const rel = await updateReleaseStatus(body.id, body.status, body.actor || 'admin');
        if (!rel) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        return new Response(JSON.stringify({ ok: true, release: rel }), { status: 200 });
      }

      case 'record-structured-change': {
        const sc = await recordStructuredChange({
          changeType: body.changeType,
          targetType: body.targetType,
          targetId: body.targetId,
          before: body.before,
          after: body.after,
          actor: body.actor || 'admin',
          relatedChangeRequestId: body.relatedChangeRequestId,
        });
        return new Response(JSON.stringify({ ok: true, structured: sc }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
