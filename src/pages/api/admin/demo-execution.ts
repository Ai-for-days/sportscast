import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { submitDemoOrder, listDemoOrders, cancelDemoOrder, refreshDemoOrderStatus } from '../../../lib/kalshi-execution';
import { getCandidate, listCandidates, updateCandidateState } from '../../../lib/order-builder';
import { getExecutionConfig } from '../../../lib/execution-config';
import { requirePermission } from '../../../lib/sensitive-actions';
import { withMetric } from '../../../lib/health-metrics';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [config, orders, candidates] = await Promise.all([
      getExecutionConfig(),
      listDemoOrders(),
      listCandidates(),
    ]);

    const approvedCandidates = candidates.filter(c => c.state === 'approved');

    return new Response(JSON.stringify({
      config,
      orders,
      approvedCandidates,
      summary: {
        approvedCount: approvedCandidates.length,
        submittedCount: orders.length,
        openCount: orders.filter(o => o.status === 'open' || o.status === 'pending').length,
        filledCount: orders.filter(o => o.status === 'filled').length,
        failedCount: orders.filter(o => o.status === 'failed').length,
        cancelledCount: orders.filter(o => o.status === 'cancelled').length,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
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

    if (action === 'submit') {
      const permCheck = await requirePermission(session, 'submit_demo_orders', 'demo order submission');
      if (!permCheck.allowed) {
        return new Response(JSON.stringify({ error: permCheck.reason, code: permCheck.code }), { status: 403 });
      }
      const config = await getExecutionConfig();
      if (!config.demoTradingEnabled) {
        return new Response(JSON.stringify({ error: 'Demo trading is not enabled', code: 'invalid_state' }), { status: 403 });
      }

      const { candidateId } = body;
      if (!candidateId) {
        return new Response(JSON.stringify({ error: 'Missing candidateId' }), { status: 400 });
      }

      const candidate = await getCandidate(candidateId);
      if (!candidate) {
        return new Response(JSON.stringify({ error: 'Candidate not found' }), { status: 404 });
      }

      const { result: order } = await withMetric('demo_execution', 'execution', () => submitDemoOrder(candidate));

      // Update candidate state
      if (order.status === 'open') {
        await updateCandidateState(candidateId, 'sent' as any);
      }

      return new Response(JSON.stringify({ order }), {
        status: order.status === 'failed' ? 422 : 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'cancel') {
      const { orderId } = body;
      if (!orderId) {
        return new Response(JSON.stringify({ error: 'Missing orderId' }), { status: 400 });
      }
      const order = await cancelDemoOrder(orderId);
      if (!order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ order }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (action === 'refresh') {
      const { orderId } = body;
      if (!orderId) {
        return new Response(JSON.stringify({ error: 'Missing orderId' }), { status: 400 });
      }
      const order = await refreshDemoOrderStatus(orderId);
      if (!order) {
        return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ order }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
