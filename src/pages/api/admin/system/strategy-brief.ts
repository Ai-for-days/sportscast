import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  generateBrief, listBriefs, getBrief, addBriefNote,
  listAlerts, getAlert, acknowledgeAlert, resolveAlert, addAlertNote,
  summarizeHistory, evaluateAlertRules,
  BriefError,
} from '../../../../lib/strategy-brief';
import { buildScorecard } from '../../../../lib/strategy-scorecard';
import { withTiming } from '../../../../lib/performance-metrics';
import { cached } from '../../../../lib/performance-cache';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'today';

    if (action === 'today') {
      // Today = most recent brief whose date is the current UTC day, or null.
      const briefs = await listBriefs(30);
      const today = new Date().toISOString().slice(0, 10);
      const todays = briefs.filter(b => b.date === today);
      const alerts = await listAlerts(200);
      const openAlerts = alerts.filter(a => a.status !== 'resolved');
      return jsonResponse({
        date: today,
        todaysBriefs: todays,
        latestBrief: briefs[0] ?? null,
        openAlertCount: openAlerts.length,
      });
    }

    if (action === 'history') {
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.min(365, Math.max(1, Number(limitParam) || 60)) : 60;
      const briefs = await withTiming(
        'strategy-brief:history',
        'quant-review',
        () => cached('strategy-brief:list', () => listBriefs(limit), 30_000),
      );
      const summary = summarizeHistory(briefs);
      return jsonResponse({ briefs, summary });
    }

    if (action === 'get') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const b = await getBrief(id);
      if (!b) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ brief: b });
    }

    if (action === 'alerts') {
      const alerts = await listAlerts(500);
      return jsonResponse({
        alerts,
        counts: {
          open: alerts.filter(a => a.status === 'open').length,
          acknowledged: alerts.filter(a => a.status === 'acknowledged').length,
          resolved: alerts.filter(a => a.status === 'resolved').length,
          total: alerts.length,
        },
      });
    }

    if (action === 'alert') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const a = await getAlert(id);
      if (!a) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ alert: a });
    }

    if (action === 'summary') {
      // Lightweight: scorecard + alert rule preview without persisting anything
      const scorecard = await withTiming(
        'strategy-brief:summary',
        'quant-review',
        () => cached('strategy-brief:summary', async () => {
          const sc = await buildScorecard();
          return { sc, fired: evaluateAlertRules(sc) };
        }, 30_000),
      );
      return jsonResponse({
        scorecard: scorecard.sc,
        firedRules: scorecard.fired,
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'strategy_brief_failed', message: err?.message ?? String(err) }, 500);
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
    const operatorId = await getOperatorId(session ?? '');

    if (action === 'generate-brief') {
      const { brief, firedAlerts } = await generateBrief({ generatedBy: operatorId, note: body.note });
      return jsonResponse({ brief, firedAlerts });
    }

    if (action === 'acknowledge-alert') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      const a = await acknowledgeAlert(body.id, operatorId, body.note);
      return jsonResponse({ alert: a });
    }

    if (action === 'resolve-alert') {
      if (!body.id) return jsonResponse({ error: 'id required' }, 400);
      if (!body.resolution || !String(body.resolution).trim()) {
        return jsonResponse({ error: 'resolution_required', message: 'resolution is required' }, 400);
      }
      const a = await resolveAlert(body.id, operatorId, String(body.resolution));
      return jsonResponse({ alert: a });
    }

    if (action === 'add-alert-note') {
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const a = await addAlertNote(body.id, body.note, operatorId);
      return jsonResponse({ alert: a });
    }

    if (action === 'add-note') {
      // Adds a note to a brief (matches step 88 spec wording)
      if (!body.id || !body.note) return jsonResponse({ error: 'id and note required' }, 400);
      const b = await addBriefNote(body.id, body.note, operatorId);
      return jsonResponse({ brief: b });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof BriefError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'strategy_brief_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
