import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { createCandidate, listCandidates, updateCandidateState } from '../../../lib/order-builder';
import { generateRankedSignals } from '../../../lib/signal-ranking';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const candidates = await listCandidates();
    return new Response(JSON.stringify({ candidates }), {
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
      const { signalId, stakeCents, notes } = body;
      if (!signalId) {
        return new Response(JSON.stringify({ error: 'Missing signalId' }), { status: 400 });
      }

      const signals = await generateRankedSignals();
      const signal = signals.find(s => s.id === signalId);
      if (!signal) {
        return new Response(JSON.stringify({ error: 'Signal not found' }), { status: 404 });
      }

      const candidate = await createCandidate(signal, stakeCents || 500, notes);
      return new Response(JSON.stringify({ candidate }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'approve') {
      const { id } = body;
      const candidate = await updateCandidateState(id, 'approved');
      if (!candidate) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify({ candidate }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (action === 'block') {
      const { id, reason } = body;
      const candidate = await updateCandidateState(id, 'blocked', reason || 'Manually blocked');
      if (!candidate) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify({ candidate }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (action === 'cancel') {
      const { id } = body;
      const candidate = await updateCandidateState(id, 'cancelled');
      if (!candidate) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      return new Response(JSON.stringify({ candidate }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
