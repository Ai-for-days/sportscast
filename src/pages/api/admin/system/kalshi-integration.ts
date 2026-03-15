import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getExecutionConfig } from '../../../../lib/execution-config';
import { getRedis } from '../../../../lib/redis';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getOperatorId } from '../../../../lib/admin-auth';
import { KALSHI_CONFIG } from '../../../../lib/kalshi';

export const prerender = false;

interface VerificationCheck {
  key: string;
  category: 'external_connectivity' | 'local_data' | 'execution_readiness';
  title: string;
  status: 'pass' | 'warning' | 'fail';
  summary: string;
  lastRun: string;
}

async function runKalshiChecks(): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const now = new Date().toISOString();
  const apiKey = import.meta.env.KALSHI_API_KEY;
  const kalshiMode = import.meta.env.KALSHI_MODE;
  const redis = getRedis();

  /* ================================================================ */
  /*  EXTERNAL CONNECTIVITY                                            */
  /* ================================================================ */

  // 1. API credentials present
  checks.push({
    key: 'credentials', category: 'external_connectivity',
    title: 'Kalshi API Credentials',
    status: apiKey ? 'pass' : 'fail',
    summary: apiKey ? `API key configured (${apiKey.length} chars). Mode: ${kalshiMode || 'not set'}.` : 'KALSHI_API_KEY is not set — Kalshi integration will not work.',
    lastRun: now,
  });

  // 2. Mode configuration
  checks.push({
    key: 'mode', category: 'external_connectivity',
    title: 'Kalshi Mode Configuration',
    status: kalshiMode ? 'pass' : 'warning',
    summary: kalshiMode ? `KALSHI_MODE = "${kalshiMode}". API base: ${KALSHI_CONFIG.apiBase}` : 'KALSHI_MODE not set — defaults to "paper". Set explicitly for production use.',
    lastRun: now,
  });

  // 3. LIVE external connectivity check — fetch a small market sample from Kalshi API
  if (apiKey && kalshiMode !== 'disabled' && kalshiMode !== 'demo') {
    try {
      const url = new URL(`${KALSHI_CONFIG.apiBase}/markets`);
      url.searchParams.set('limit', '3');
      url.searchParams.set('status', 'open');
      url.searchParams.set('series_ticker', 'KXHIGH');

      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10_000) });

      if (res.ok) {
        const body = await res.json();
        const marketCount = body.markets?.length ?? 0;
        checks.push({
          key: 'live_api_fetch', category: 'external_connectivity',
          title: 'Live Kalshi API Connectivity',
          status: 'pass',
          summary: `Successfully fetched ${marketCount} market(s) from Kalshi API (HTTP ${res.status}). External connectivity verified.`,
          lastRun: now,
        });
      } else {
        checks.push({
          key: 'live_api_fetch', category: 'external_connectivity',
          title: 'Live Kalshi API Connectivity',
          status: 'fail',
          summary: `Kalshi API returned HTTP ${res.status}. Authentication or endpoint issue. Check API key and mode.`,
          lastRun: now,
        });
      }
    } catch (err: any) {
      checks.push({
        key: 'live_api_fetch', category: 'external_connectivity',
        title: 'Live Kalshi API Connectivity',
        status: 'fail',
        summary: `Failed to reach Kalshi API: ${err.message}. Check network connectivity and API base URL.`,
        lastRun: now,
      });
    }
  } else if (kalshiMode === 'demo') {
    checks.push({
      key: 'live_api_fetch', category: 'external_connectivity',
      title: 'Live Kalshi API Connectivity',
      status: 'warning',
      summary: 'KALSHI_MODE is "demo" — external API connectivity not tested. Demo mode uses generated mock data. Switch to "paper" or "live" to verify real API connectivity.',
      lastRun: now,
    });
  } else if (!apiKey) {
    checks.push({
      key: 'live_api_fetch', category: 'external_connectivity',
      title: 'Live Kalshi API Connectivity',
      status: 'fail',
      summary: 'Cannot verify external connectivity — no API key configured.',
      lastRun: now,
    });
  }

  /* ================================================================ */
  /*  LOCAL DATA PRESENCE                                               */
  /* ================================================================ */

  const marketCount = await redis.zcard('kalshi-markets:all');
  checks.push({
    key: 'cached_markets', category: 'local_data',
    title: 'Cached Market Data Present',
    status: marketCount > 0 ? 'pass' : 'warning',
    summary: marketCount > 0 ? `${marketCount} markets cached locally in kalshi-markets:all.` : 'No cached market data. Navigate to /admin/kalshi-lab and fetch markets.',
    lastRun: now,
  });

  const signalCount = await redis.zcard('kalshi-signals:all');
  checks.push({
    key: 'cached_signals', category: 'local_data',
    title: 'Cached Kalshi Signal Data Present',
    status: signalCount > 0 ? 'pass' : 'warning',
    summary: signalCount > 0 ? `${signalCount} signals cached locally.` : 'No cached signal data. Generate signals from /admin/signals.',
    lastRun: now,
  });

  const demoCount = await redis.zcard('kalshi:demo:orders');
  checks.push({
    key: 'demo_order_history', category: 'local_data',
    title: 'Demo Order History Present',
    status: demoCount > 0 ? 'pass' : 'warning',
    summary: demoCount > 0 ? `${demoCount} demo orders on record.` : 'No demo orders found. Run a demo execution to test the full path.',
    lastRun: now,
  });

  /* ================================================================ */
  /*  EXECUTION READINESS                                               */
  /* ================================================================ */

  const config = await getExecutionConfig();
  checks.push({
    key: 'demo_config', category: 'execution_readiness',
    title: 'Demo Execution Configuration',
    status: config.demoTradingEnabled ? 'pass' : 'warning',
    summary: `Demo trading: ${config.demoTradingEnabled ? 'enabled' : 'disabled'}. Mode: ${config.mode}. Approval required: ${config.requireApproval}.`,
    lastRun: now,
  });

  checks.push({
    key: 'live_config', category: 'execution_readiness',
    title: 'Live Execution Configuration',
    status: 'pass',
    summary: `Live trading: ${config.liveTradingEnabled ? 'enabled' : 'disabled'}. Kill switch: ${config.killSwitchEnabled ? 'ACTIVE (blocking)' : 'inactive'}. Mode: ${config.mode}. All live execution remains operator-controlled.`,
    lastRun: now,
  });

  checks.push({
    key: 'kill_switch', category: 'execution_readiness',
    title: 'Kill Switch State',
    status: config.killSwitchEnabled ? 'warning' : 'pass',
    summary: config.killSwitchEnabled ? 'Kill switch is ACTIVE — all execution is blocked. Deactivate via /admin/execution-control when ready.' : 'Kill switch inactive — execution is not blocked by kill switch.',
    lastRun: now,
  });

  return checks;
}

const CATEGORY_LABELS: Record<string, string> = {
  external_connectivity: 'External Connectivity',
  local_data: 'Local Data Presence',
  execution_readiness: 'Execution Readiness',
};

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const checks = await runKalshiChecks();
    const pass = checks.filter(c => c.status === 'pass').length;
    const warn = checks.filter(c => c.status === 'warning').length;
    const fail = checks.filter(c => c.status === 'fail').length;
    const categories = ['external_connectivity', 'local_data', 'execution_readiness'];
    return new Response(JSON.stringify({ checks, summary: { total: checks.length, pass, warning: warn, fail }, categories, categoryLabels: CATEGORY_LABELS }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const body = await request.json();
    if (body.action === 'run-verification') {
      const operatorId = await getOperatorId(session);
      const checks = await runKalshiChecks();
      const pass = checks.filter(c => c.status === 'pass').length;
      const fail = checks.filter(c => c.status === 'fail').length;
      await logAuditEvent({ actor: operatorId, eventType: 'kalshi_verification', targetType: 'kalshi-integration', targetId: 'all', summary: `Kalshi verification: ${pass} pass, ${fail} fail` });
      const categories = ['external_connectivity', 'local_data', 'execution_readiness'];
      return new Response(JSON.stringify({ ok: true, checks, summary: { total: checks.length, pass, warning: checks.filter(c => c.status === 'warning').length, fail }, categories, categoryLabels: CATEGORY_LABELS }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `Unknown action: ${body.action}` }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
