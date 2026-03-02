import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getStripe } from '../../../lib/stripe';
import { getRedis } from '../../../lib/redis';

const MIN_DEPOSIT = 500;     // $5.00
const MAX_DEPOSIT = 50000;   // $500.00

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

    if (!amountCents || typeof amountCents !== 'number' || !Number.isInteger(amountCents)) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (amountCents < MIN_DEPOSIT || amountCents > MAX_DEPOSIT) {
      return new Response(JSON.stringify({ error: `Deposit must be between $${(MIN_DEPOSIT / 100).toFixed(2)} and $${(MAX_DEPOSIT / 100).toFixed(2)}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Wager on Weather Deposit',
            description: `Add $${(amountCents / 100).toFixed(2)} to your balance`,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${new URL(request.url).origin}/account?deposit=success`,
      cancel_url: `${new URL(request.url).origin}/account?deposit=cancelled`,
      metadata: {
        userId: user.id,
        amountCents: amountCents.toString(),
      },
    });

    // Store mapping so webhook can find the user
    const redis = getRedis();
    await redis.set(`stripe-session:${session.id}`, user.id, { ex: 3600 });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
