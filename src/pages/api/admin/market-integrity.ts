import type { APIRoute } from 'astro';
import { requireAdmin, getOperatorId } from '../../../lib/admin-auth';
import {
  analyzeMarketIntegrity,
  listIntegrityReports,
  getIntegrityReport,
  getLatestIntegrityReportForWager,
  getIntegritySummary,
  listIntegrityTargets,
  MarketIntegrityError,
} from '../../../lib/market-integrity';

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
      const [summary, reports, targets] = await Promise.all([
        getIntegritySummary(),
        listIntegrityReports(100),
        listIntegrityTargets(200),
      ]);
      return jsonResponse({ summary, reports, targets });
    }

    if (action === 'list-reports') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 100)) : 100;
      const reports = await listIntegrityReports(limit);
      return jsonResponse({ reports });
    }

    if (action === 'get-report') {
      const id = url.searchParams.get('id');
      if (!id) return jsonResponse({ error: 'id required' }, 400);
      const report = await getIntegrityReport(id);
      if (!report) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse({ report });
    }

    if (action === 'get-by-wager') {
      const wagerId = url.searchParams.get('wagerId');
      if (!wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const report = await getLatestIntegrityReportForWager(wagerId);
      return jsonResponse({ report });
    }

    if (action === 'list-targets') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Math.min(500, Math.max(1, Number(limitRaw) || 200)) : 200;
      const targets = await listIntegrityTargets(limit);
      return jsonResponse({ targets });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    return jsonResponse({ error: 'market_integrity_failed', message: err?.message ?? String(err) }, 500);
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

    if (action === 'analyze') {
      if (!body.wagerId) return jsonResponse({ error: 'wagerId required' }, 400);
      const report = await analyzeMarketIntegrity(body.wagerId, actor);
      return jsonResponse({ report });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err: any) {
    if (err instanceof MarketIntegrityError) {
      return jsonResponse({ error: err.code, message: err.message }, 400);
    }
    return jsonResponse({ error: 'market_integrity_action_failed', message: err?.message ?? String(err) }, 500);
  }
};
