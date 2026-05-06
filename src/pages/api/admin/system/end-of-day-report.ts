import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  generateEndOfDayReport,
  getEndOfDayReport,
  listEndOfDayReports,
  EndOfDayReportError,
} from '../../../../lib/end-of-day-report';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'get';

    if (action === 'get') {
      const date = url.searchParams.get('date');
      if (!date) return jsonResponse({ error: 'date required' }, 400);
      const report = await getEndOfDayReport(date);
      return jsonResponse({ date, report });
    }

    if (action === 'list') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(365, Math.max(1, Number(limitRaw) || 60)) : 60;
      const reports = await listEndOfDayReports(limit);
      return jsonResponse({ reports });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'end_of_day_report_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'generate') {
      if (!body.date) return jsonResponse({ error: 'date required' }, 400);
      const report = await generateEndOfDayReport(body.date, actor);
      return jsonResponse({ report });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof EndOfDayReportError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'end_of_day_report_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
