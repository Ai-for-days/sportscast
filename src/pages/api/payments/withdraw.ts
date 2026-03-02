import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { debitBalance, recordTransaction } from '../../../lib/wallet-store';
import { getRedis } from '../../../lib/redis';

const MIN_WITHDRAWAL = 1000; // $10.00

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
    const { amountCents } = body as { amountCents?: number };

    if (!amountCents || typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents < MIN_WITHDRAWAL) {
      return new Response(JSON.stringify({ error: `Minimum withdrawal is $${(MIN_WITHDRAWAL / 100).toFixed(2)}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Debit balance
    const newBalance = await debitBalance(user.id, amountCents);

    // Record transaction
    await recordTransaction({
      userId: user.id,
      type: 'withdrawal',
      amountCents: -amountCents,
      balanceAfterCents: newBalance,
      description: `Withdrawal request: $${(amountCents / 100).toFixed(2)}`,
    });

    // Store withdrawal request for admin processing
    const redis = getRedis();
    const requestId = `wr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await redis.set(`withdrawal-request:${requestId}`, JSON.stringify({
      id: requestId,
      userId: user.id,
      email: user.email,
      amountCents,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }));
    await redis.zadd('withdrawal-requests:pending', { score: Date.now(), member: requestId });

    return new Response(JSON.stringify({ ok: true, requestId, newBalanceCents: newBalance }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    const status = err.message.includes('Insufficient') ? 402 : 500;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
