import type { APIRoute } from 'astro';
import { getStripe } from '../../../lib/stripe';
import { getRedis } from '../../../lib/redis';
import { creditBalance, getBalance, recordTransaction } from '../../../lib/wallet-store';

export const POST: APIRoute = async ({ request }) => {
  const stripe = getStripe();
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return new Response(JSON.stringify({ error: 'Missing signature or secret' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const amountCents = parseInt(session.metadata?.amountCents || '0', 10);

    if (userId && amountCents > 0) {
      // Idempotency: check if we already processed this session
      const redis = getRedis();
      const processedKey = `stripe-processed:${session.id}`;
      const already = await redis.get(processedKey);
      if (!already) {
        const newBalance = await creditBalance(userId, amountCents);
        await recordTransaction({
          userId,
          type: 'deposit',
          amountCents,
          balanceAfterCents: newBalance,
          description: `Deposited $${(amountCents / 100).toFixed(2)}`,
          referenceId: session.id,
        });
        await redis.set(processedKey, 'true', { ex: 86400 }); // 24h idempotency
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
