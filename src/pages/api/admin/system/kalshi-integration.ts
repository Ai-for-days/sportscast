import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { getExecutionConfig } from '../../../../lib/execution-config';
import { getRedis } from '../../../../lib/redis';
import { logAuditEvent } from '../../../../lib/audit-log';
import { getOperatorId } from '../../../../lib/admin-auth';

export const prerender = false;

async function runKalshiChecks() {
  const checks: any[] = [];

  // 1. Credentials check
  const apiKey = import.meta.env.KALSHI_API_KEY;
  const kalshiMode = import.meta.env.KALSHI_MODE;
  checks.push({
    key: 'credentials', title: 'Kalshi API Credentials',
    status: apiKey ? 'pass' : 'fail',
    summary: apiKey ? `API key configured (${apiKey.length} chars). Mode: ${kalshiMode || 'not set'}` : 'KALSHI_API_KEY is not set — Kalshi integration will not work.',
    lastRun: new Date().toISOString(),
  });

  // 2. Mode configuration
  checks.push({
    key: 'mode', title: 'Kalshi Mode Configuration',
    status: kalshiMode ? 'pass' : 'warning',
    summary: kalshiMode ? `KALSHI_MODE = "${kalshiMode}". Ensure this matches your intended environment (demo vs production).` : 'KALSHI_MODE not set — defaults may apply. Set to "demo" or "production" explicitly.',
    lastRun: new Date().toISOString(),
  });

  // 3. Market data availability
  const redis = getRedis();
  const marketCount = await redis.zcard('kalshi-markets:all');
  checks.push({
    key: 'market_data', title: 'Kalshi Market Data',
    status: marketCount > 0 ? 'pass' : 'warning',
    summary: marketCount > 0 ? `${marketCount} markets in kalshi-markets:all index.` : 'No Kalshi market data found. Navigate to /admin/kalshi-lab and fetch markets.',
    lastRun: new Date().toISOString(),
  });

  // 4. Signal data availability
  const signalCount = await redis.zcard('kalshi-signals:all');
  checks.push({
    key: 'signal_data', title: 'Kalshi Signal Data',
    status: signalCount > 0 ? 'pass' : 'warning',
    summary: signalCount > 0 ? `${signalCount} signals in kalshi-signals:all index.` : 'No Kalshi signal data found. Generate signals from /admin/signals.',
    lastRun: new Date().toISOString(),
  });

  // 5. Demo execution config
  const config = await getExecutionConfig();
  checks.push({
    key: 'demo_config', title: 'Demo Execution Path',
    status: config.demoTradingEnabled ? 'pass' : 'warning',
    summary: `Demo trading: ${config.demoTradingEnabled ? 'enabled' : 'disabled'}. Mode: ${config.mode}. Approval required: ${config.requireApproval}.`,
    lastRun: new Date().toISOString(),
  });

  // 6. Live execution readiness
  checks.push({
    key: 'live_config', title: 'Live Execution Readiness',
    status: 'pass',
    summary: `Live trading: ${config.liveTradingEnabled ? 'enabled' : 'disabled'}. Kill switch: ${config.killSwitchEnabled ? 'ACTIVE (blocking)' : 'inactive'}. Mode: ${config.mode}. All live execution remains operator-controlled.`,
    lastRun: new Date().toISOString(),
  });

  // 7. Demo orders presence
  const demoCount = await redis.zcard('kalshi:demo:orders');
  checks.push({
    key: 'demo_orders', title: 'Demo Order History',
    status: demoCount > 0 ? 'pass' : 'warning',
    summary: demoCount > 0 ? `${demoCount} demo orders on record.` : 'No demo orders found. Run a demo execution to test the full path.',
    lastRun: new Date().toISOString(),
  });

  return checks;
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  try {
    const checks = await runKalshiChecks();
    const pass = checks.filter((c: any) => c.status === 'pass').length;
    const warn = checks.filter((c: any) => c.status === 'warning').length;
    const fail = checks.filter((c: any) => c.status === 'fail').length;
    return new Response(JSON.stringify({ checks, summary: { total: checks.length, pass, warning: warn, fail } }), { status: 200 });
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
      await logAuditEvent({ actor: operatorId, eventType: 'kalshi_verification', targetType: 'kalshi-integration', targetId: 'all', summary: `Kalshi verification: ${checks.filter((c: any) => c.status === 'pass').length} pass, ${checks.filter((c: any) => c.status === 'fail').length} fail` });
      return new Response(JSON.stringify({ ok: true, checks }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `Unknown action: ${body.action}` }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
