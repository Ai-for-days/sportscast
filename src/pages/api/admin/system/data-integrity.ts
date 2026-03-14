import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getOperatorId } from '../../../../lib/admin-auth';
import {
  runAllIntegrityChecks, runDomainIntegrityChecks,
  saveScanBatch, listScanHistory, getDomainDefinitions, DOMAIN_LABELS,
} from '../../../../lib/data-integrity';
import { logAuditEvent } from '../../../../lib/audit-log';
import { cached } from '../../../../lib/performance-cache';
import { withTiming } from '../../../../lib/performance-metrics';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const action = url.searchParams.get('action') || 'overview';

    if (action === 'history') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const { result: records, durationMs } = await withTiming(
        '/api/admin/system/data-integrity?history', 'data-integrity',
        () => listScanHistory(limit),
      );
      return new Response(JSON.stringify({ records, _meta: { count: records.length, limit, durationMs } }), { status: 200 });
    }

    const { result: overview, durationMs } = await withTiming(
      '/api/admin/system/data-integrity?overview', 'data-integrity',
      () => cached('data-integrity:overview', async () => {
        const [domains, history] = await Promise.all([
          getDomainDefinitions(),
          listScanHistory(20),
        ]);
        return { domains, domainLabels: DOMAIN_LABELS, recentHistory: history };
      }, 30_000),
    );

    return new Response(JSON.stringify({ ...overview, _meta: { durationMs } }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;
    const operatorId = await getOperatorId(session);

    switch (action) {
      case 'scan-all': {
        const checks = await runAllIntegrityChecks();
        const records = await saveScanBatch(checks);
        await logAuditEvent({
          actor: operatorId,
          eventType: 'data_integrity_scan',
          targetType: 'data-integrity',
          targetId: 'all',
          summary: `Full integrity scan: ${checks.filter(c => c.status === 'pass').length} pass, ${checks.filter(c => c.status === 'fail').length} fail, ${checks.filter(c => c.status === 'warn').length} warn across ${new Set(checks.map(c => c.domain)).size} domains`,
        });
        return new Response(JSON.stringify({ ok: true, checks, records }), { status: 200 });
      }

      case 'scan-domain': {
        const domain = body.domain;
        if (!domain) return new Response(JSON.stringify({ error: 'domain required' }), { status: 400 });
        const checks = await runDomainIntegrityChecks(domain);
        if (checks.length === 0) return new Response(JSON.stringify({ error: `Unknown domain: ${domain}` }), { status: 404 });
        const records = await saveScanBatch(checks);
        return new Response(JSON.stringify({ ok: true, checks, records }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
