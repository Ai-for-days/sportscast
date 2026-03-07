import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { getRedis } from '../../../lib/redis';
import { resetBankroll } from '../../../lib/bookmaker-store';
import { listAllUsers } from '../../../lib/user-store';

const PLAYER_BALANCE_CENTS = 25_000_000; // $250,000

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const redis = getRedis();

    // Delete all bets, wagers, and transactions
    const patterns = [
      'bet:*', 'bets:by-user:*', 'bets:by-wager:*',
      'wager:*', 'wagers:by-status:*', 'wagers:by-date:*', 'wagers:all',
      'transaction:*', 'transactions:*',
    ];
    let totalDeleted = 0;

    for (const pattern of patterns) {
      if (!pattern.includes('*')) {
        // Exact key
        await redis.del(pattern);
        totalDeleted++;
        continue;
      }
      let cursor = 0;
      do {
        const result = await redis.scan(cursor, { match: pattern, count: 100 });
        cursor = result[0] as unknown as number;
        const keys = result[1] as string[];
        if (keys.length > 0) {
          const pipeline = redis.pipeline();
          for (const key of keys) {
            pipeline.del(key);
          }
          await pipeline.exec();
          totalDeleted += keys.length;
        }
      } while (cursor !== 0);
    }

    // Reset all player balances to $250,000
    const users = await listAllUsers();
    let playersReset = 0;
    for (const user of users) {
      await redis.set(`balance:${user.id}`, PLAYER_BALANCE_CENTS);
      playersReset++;
    }

    // Reset bookmaker bankroll to $1,000,000
    const newBankroll = await resetBankroll();

    return new Response(JSON.stringify({
      success: true,
      keysDeleted: totalDeleted,
      playersReset,
      playerBalanceCents: PLAYER_BALANCE_CENTS,
      bankrollCents: newBankroll,
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
