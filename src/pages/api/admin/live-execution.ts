import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { submitLiveOrder, listLiveOrders, cancelLiveOrder, refreshLiveOrderStatus } from '../../../lib/kalshi-execution';
import { getCandidate, listCandidates, updateCandidateState } from '../../../lib/order-builder';
import { getExecutionConfig } from '../../../lib/execution-config';
import { runReadinessChecks } from '../../../lib/live-readiness';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [config, orders, candidates, readiness] = await Promise.all([
      getExecutionConfig(),
      listLiveOrders(),
      listCandidates(),
      runReadinessChecks(),
    ]);

    const approvedCandidates = candidates.filter(c =>
      c.state === 'approved' && c.source === 'kalshi'
    );

    return new Response(JSON.stringify({
      config,
      orders,
      approvedCandidates,
      readiness: { ready: readiness.ready, criticalFailures: readiness.criticalFailures },
      summary: {
        approvedCount: approvedCandidates.length,
        submittedCount: orders.length,
        openCount: orders.filter(o => o.status === 'open' || o.status === 'pending' || o.status === 'partially-filled').length,
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
      const { candidateId, confirmationPhrase } = body;
      if (!candidateId) {
        return new Response(JSON.stringify({ error: 'Missing candidateId' }), { status: 400 });
      }
      if (!confirmationPhrase || confirmationPhrase.trim() !== 'SUBMIT LIVE ORDER') {
        return new Response(JSON.stringify({
          error: 'Confirmation phrase must be exactly "SUBMIT LIVE ORDER"',
          denied: true,
        }), { status: 422 });
      }

      const candidate = await getCandidate(candidateId);
      if (!candidate) {
        return new Response(JSON.stringify({ error: 'Candidate not found' }), { status: 404 });
      }

      const order = await submitLiveOrder(candidate);

      // Update candidate state on success
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
      const order = await cancelLiveOrder(orderId);
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
      const order = await refreshLiveOrderStatus(orderId);
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
