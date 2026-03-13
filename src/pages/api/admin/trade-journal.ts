import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  listJournalEntries,
  createJournalEntry,
  updateJournalEntry,
  settleJournalEntry,
  getJournalSummary,
  buildJournalFromSignal,
} from '../../../lib/trade-journal';
import { generateRankedSignals } from '../../../lib/signal-ranking';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const [entries, summary] = await Promise.all([
      listJournalEntries(),
      getJournalSummary(),
    ]);

    return new Response(JSON.stringify({ entries, summary }), {
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

    if (action === 'create') {
      const entry = await createJournalEntry(body.entry);
      return new Response(JSON.stringify({ entry }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create-from-signal') {
      const { signalId, thesis, notes } = body;
      const signals = await generateRankedSignals();
      const signal = signals.find(s => s.id === signalId);
      if (!signal) {
        return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404 });
      }
      const partial = buildJournalFromSignal(signal, { thesis, notes });
      const entry = await createJournalEntry(partial);
      return new Response(JSON.stringify({ entry }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'update') {
      const { id, ...updates } = body;
      const entry = await updateJournalEntry(id, updates);
      if (!entry) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ entry }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'settle') {
      const { id, result, pnlCents, postmortem } = body;
      const entry = await settleJournalEntry(id, result, pnlCents, postmortem);
      if (!entry) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ entry }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
