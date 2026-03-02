import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getUserByEmail } from '../../../lib/user-store';
import { creditBalance, recordTransaction } from '../../../lib/wallet-store';

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { email, amountCents } = body as { email?: string; amountCents?: number };

    if (!email || !amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
      return new Response(JSON.stringify({ error: 'email and positive amountCents are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const newBalance = await creditBalance(user.id, amountCents);

    await recordTransaction({
      userId: user.id,
      type: 'deposit',
      amountCents,
      balanceAfterCents: newBalance,
      description: `Admin credit: $${(amountCents / 100).toFixed(2)}`,
    });

    return new Response(JSON.stringify({
      ok: true,
      userId: user.id,
      email: user.email,
      creditedCents: amountCents,
      newBalanceCents: newBalance,
    }), {
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
