import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import {
  createPaperTrade,
  listPaperTrades,
  settlePaperTrade,
  getPaperTradeSummary,
} from '../../../../lib/kalshi-signals';
import type { KalshiSignal } from '../../../../lib/kalshi-signals';
import { createJournalEntry, buildJournalFromPaperTrade } from '../../../../lib/trade-journal';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [trades, summary] = await Promise.all([
      listPaperTrades(),
      getPaperTradeSummary(),
    ]);
    return new Response(JSON.stringify({ trades, summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
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

    if (action === 'create') {
      const { signal, side, stakeCents, notes } = body;
      if (!signal || !side || !stakeCents) {
        return new Response(JSON.stringify({ error: 'Missing required fields: signal, side, stakeCents' }), { status: 400 });
      }
      const trade = await createPaperTrade(signal as KalshiSignal, side, stakeCents, notes);
      // Auto-journal the paper trade
      try {
        const journalPartial = buildJournalFromPaperTrade(trade);
        await createJournalEntry(journalPartial);
      } catch { /* journal creation is best-effort */ }
      return new Response(JSON.stringify({ trade }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'settle') {
      const { id, settlementPrice } = body;
      if (!id || settlementPrice == null) {
        return new Response(JSON.stringify({ error: 'Missing required fields: id, settlementPrice' }), { status: 400 });
      }
      const trade = await settlePaperTrade(id, settlementPrice);
      if (!trade) {
        return new Response(JSON.stringify({ error: 'Trade not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ trade }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
