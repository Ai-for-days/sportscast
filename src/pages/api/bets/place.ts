import type { APIRoute } from 'astro';
import { requireUser } from '../../../lib/user-auth';
import { getBalance, debitBalance, recordTransaction } from '../../../lib/wallet-store';
import { getRedis } from '../../../lib/redis';
import { getFeedGame, getFeedSummary } from '../../../lib/odds-feed-store';
import { checkLeg } from '../../../lib/sportsbook-bet-check';

interface BetLeg {
  gameId: string;
  gameDescription: string;
  oddsType: 'moneyline' | 'spread' | 'total';
  side: 'away' | 'home' | 'over' | 'under';
  odds: number;
  line?: number; // For spread/total
}

interface PlaceBetRequest {
  legs: BetLeg[];
  stake: number; // In dollars
}

function generateBetId(): string {
  return `bet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const POST: APIRoute = async ({ request }) => {
  // Verify user session
  const user = await requireUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // A player the owner added gets a temporary password and must set their own
  // before betting (DBD 2026-11-20). A frozen account cannot bet at all.
  if (user.mustChangePassword) {
    return new Response(JSON.stringify({ error: 'Please set a new password on your Account page before betting.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (user.frozen) {
    return new Response(JSON.stringify({ error: 'Account frozen. Contact support.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as PlaceBetRequest;
    const { legs, stake } = body;

    // Validate inputs
    if (!legs || !Array.isArray(legs) || legs.length === 0) {
      return new Response(JSON.stringify({ error: 'At least one bet leg required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!stake || stake <= 0 || stake > 1_000_000) {
      return new Response(JSON.stringify({ error: 'Stake must be between $0.01 and $1,000,000' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate each leg
    for (const leg of legs) {
      if (!leg.gameId || !leg.oddsType || !leg.side || typeof leg.odds !== 'number') {
        return new Response(JSON.stringify({ error: 'Invalid bet leg format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!['moneyline', 'spread', 'total'].includes(leg.oddsType)) {
        return new Response(JSON.stringify({ error: 'Invalid odds type' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!['away', 'home', 'over', 'under'].includes(leg.side)) {
        return new Response(JSON.stringify({ error: 'Invalid bet side' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (Math.abs(leg.odds) < 100) {
        return new Response(JSON.stringify({ error: 'Invalid odds value' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Price every leg from OUR lines, never the browser's (sportsbook-bet-check.ts):
    // the game must be on the board, not started, with recent lines, at the price
    // and point we hold right now. The stored leg uses the server's numbers.
    if (new Set(legs.map((l) => l.gameId)).size !== legs.length) {
      return new Response(JSON.stringify({ error: 'A parlay can have only one leg per game.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const leg of legs) {
      const feed = await getFeedGame(leg.gameId);
      const summary = feed ? await getFeedSummary(feed.game.league, leg.gameId) : null;
      const check = checkLeg(leg, summary);
      if (!check.ok) {
        return new Response(JSON.stringify({ error: check.error, gameId: leg.gameId, current: check.current ?? null }), {
          status: check.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      leg.odds = check.odds;
      if (check.line !== undefined) leg.line = check.line;
      leg.gameDescription = check.description;
    }

    // Check user balance
    const stakeCents = Math.round(stake * 100);
    const currentBalance = await getBalance(user.id);

    if (currentBalance < stakeCents) {
      return new Response(JSON.stringify({ error: 'Insufficient balance' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Debit balance atomically
    const newBalance = await debitBalance(user.id, stakeCents);

    // Calculate implied odds for the bet (simplified parlay calculation)
    let decimalOdds = 1.0;
    for (const leg of legs) {
      const decimal = leg.odds > 0 ? 1 + leg.odds / 100 : 1 + 100 / Math.abs(leg.odds);
      decimalOdds *= decimal;
    }
    const toWinCents = Math.round(stakeCents * (decimalOdds - 1));

    // Record the bet
    const betId = generateBetId();
    const redis = getRedis();
    const now = new Date().toISOString();

    const bet = {
      id: betId,
      userId: user.id,
      type: legs.length === 1 ? 'single' : 'parlay',
      legs,
      stakeCents,
      decimalOdds: Math.round(decimalOdds * 10000) / 10000,
      toWinCents,
      status: 'open',
      createdAt: now,
    };

    await redis.set(`bet:${betId}`, JSON.stringify(bet));
    await redis.zadd(`user-bets:${user.id}`, { score: Date.now(), member: betId });

    // Record transaction
    await recordTransaction({
      userId: user.id,
      type: 'bet_placed',
      amountCents: -stakeCents,
      balanceAfterCents: newBalance,
      description: `${legs.length === 1 ? 'Single' : 'Parlay'} bet on ${legs.map((l) => l.gameDescription).join(' + ')}`,
      referenceId: betId,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        bet: {
          id: bet.id,
          type: bet.type,
          legCount: legs.length,
          stake,
          toWin: toWinCents / 100,
          decimalOdds: bet.decimalOdds,
          status: bet.status,
          createdAt: now,
        },
        newBalance: newBalance / 100,
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err: any) {
    console.error('[Bet placement error]', err?.message);
    return new Response(JSON.stringify({ error: 'Failed to place bet', details: err?.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
