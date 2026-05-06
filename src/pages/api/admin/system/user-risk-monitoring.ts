import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../../lib/admin-auth';
import {
  generateUserRiskReport,
  getReport,
  listReports,
  listReportsForUser,
  listKnownUsers,
  getRiskSummary,
  UserRiskError,
} from '../../../../lib/user-risk-monitoring';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const action = url.searchParams.get('action') ?? 'summary';

    if (action === 'summary') {
      const [summary, reports, users] = await Promise.all([
        getRiskSummary(),
        listReports(100),
        listKnownUsers(200),
      ]);
      return jsonResponse({ summary, reports, users });
    }

    if (action === 'list-reports') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const reports = await listReports(limit);
      return jsonResponse({ reports });
    }

    if (action === 'get-report') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const report = await getReport(id);
      if (!report) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ report });
    }

    if (action === 'get-by-user') {
      const userId = url.searchParams.get('userId');
      if (!userId) return jsonResponse({ error: 'userId required' }, 400);
      const reports = await listReportsForUser(userId);
      return jsonResponse({ reports });
    }

    if (action === 'list-users') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const users = await listKnownUsers(limit);
      return jsonResponse({ users });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'user_risk_monitoring_failed', message: err?.message ?? String(err) }, 500);
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
      if (!body.userId) return jsonResponse({ error: 'userId required' }, 400);
      const report = await generateUserRiskReport({
        userId: body.userId,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
      }, actor);
      return jsonResponse({ report });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof UserRiskError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'user_risk_monitoring_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
