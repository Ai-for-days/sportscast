// ── Customer bet API (sanitized) ────────────────────────────────────────────
//
// Step 121 Part A: GET responses pass through serializeCustomerBets so the
// raw Wager (including admin-only fields like voidReason, pricingSnapshot,
// lineHistory, openingLineSnapshot, closingLineSnapshot, internalName)
// never reaches the customer. POST responses pass through
// buildCustomerBetView for the same reason.

import type { APIRoute } from 'astro';
import { requireUser } from '../../lib/user-auth';
import { placeBet, getUserBetsEnriched } from '../../lib/bet-store';
import { getPublicWager } from '../../lib/public-wager-view';
import {
  buildCustomerBetView,
  serializeCustomerBets,
} from '../../lib/customer-bet-view';

export const POST: APIRoute = async ({ request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { wagerId, outcomeLabel, amountCents } = body as {
      wagerId?: string;
      outcomeLabel?: string;
      amountCents?: number;
    };

    if (!wagerId || !outcomeLabel || !amountCents) {
      return new Response(JSON.stringify({ error: 'wagerId, outcomeLabel, and amountCents are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bet = await placeBet(user.id, wagerId, outcomeLabel, amountCents);
    const view = await getPublicWager(wagerId);
    const safeBet = buildCustomerBetView(bet, view ?? undefined);

    return new Response(JSON.stringify(safeBet), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const status = err.message.includes('Insufficient') ? 402
      : err.message.includes('not open') ? 409
      : err.message.includes('not found') ? 404
      : 400;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async ({ request }) => {
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const { bets, total } = await getUserBetsEnriched(user.id, limit, offset);

  return new Response(
    JSON.stringify({ bets: serializeCustomerBets(bets), total }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
