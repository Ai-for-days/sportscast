import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getUserByEmail } from '../../../lib/user-store';
import { creditBalance, debitBalance, getBalance, recordTransaction } from '../../../lib/wallet-store';

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

    if (!email || amountCents == null || typeof amountCents !== 'number' || amountCents === 0) {
      return new Response(JSON.stringify({ error: 'email and non-zero amountCents are required' }), {
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

    let newBalance: number;
    const absCents = Math.abs(amountCents);

    if (amountCents > 0) {
      // Credit
      newBalance = await creditBalance(user.id, absCents);
      await recordTransaction({
        userId: user.id,
        type: 'deposit',
        amountCents: absCents,
        balanceAfterCents: newBalance,
        description: `Admin credit: +$${(absCents / 100).toFixed(2)}`,
      });
    } else {
      // Debit — check balance first to give a clear error
      const current = await getBalance(user.id);
      if (absCents > current) {
        return new Response(JSON.stringify({
          error: `Cannot debit $${(absCents / 100).toFixed(2)} — player only has $${(current / 100).toFixed(2)}`,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      newBalance = await debitBalance(user.id, absCents);
      await recordTransaction({
        userId: user.id,
        type: 'withdrawal',
        amountCents: absCents,
        balanceAfterCents: newBalance,
        description: `Admin debit: -$${(absCents / 100).toFixed(2)}`,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      userId: user.id,
      email: user.email,
      adjustedCents: amountCents,
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
