import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { reconcileAll, reconcileSingleOrder, listReconRecords, markReviewed } from '../../../lib/reconciliation';
import { listPositions, rebuildPositions, computePositionSummary } from '../../../lib/positions';
import { listLedgerEntries, rebuildLedger, computeLedgerSummary } from '../../../lib/pnl-ledger';
import { listDemoOrders, listLiveOrders } from '../../../lib/kalshi-execution';
import { withMetric } from '../../../lib/health-metrics';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [reconRecords, positions, ledgerEntries, demoOrders, liveOrders] = await Promise.all([
      listReconRecords(),
      listPositions(),
      listLedgerEntries(200),
      listDemoOrders(),
      listLiveOrders(),
    ]);

    const positionSummary = computePositionSummary(positions);
    const ledgerSummary = computeLedgerSummary(ledgerEntries);
    const unreconciledCount = reconRecords.filter(r => !r.reconciled && !r.reviewed).length;

    return new Response(JSON.stringify({
      reconRecords,
      positions,
      positionSummary,
      ledgerEntries,
      ledgerSummary,
      unreconciledCount,
      orderCounts: {
        demo: demoOrders.length,
        live: liveOrders.length,
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

    if (action === 'refresh-order') {
      const { orderId, mode } = body;
      if (!orderId || !mode) {
        return new Response(JSON.stringify({ error: 'Missing orderId or mode' }), { status: 400 });
      }
      const record = await reconcileSingleOrder(orderId, mode);
      return new Response(JSON.stringify({ record }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'refresh-all-safe') {
      const { result: records } = await withMetric('reconciliation', 'accounting', () => reconcileAll());
      return new Response(JSON.stringify({ records, count: records.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'mark-reviewed') {
      const { orderId, mode } = body;
      if (!orderId || !mode) {
        return new Response(JSON.stringify({ error: 'Missing orderId or mode' }), { status: 400 });
      }
      await markReviewed(orderId, mode);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'rebuild-positions') {
      const positions = await rebuildPositions();
      return new Response(JSON.stringify({ positions, count: positions.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'rebuild-ledger') {
      const entries = await rebuildLedger();
      return new Response(JSON.stringify({ entries, count: entries.length }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
