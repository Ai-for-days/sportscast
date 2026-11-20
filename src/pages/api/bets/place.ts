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

/** What is stored for each leg: checked fields and the server's prices only. */
interface StoredLeg {
  gameId: string;
  gameDescription: string;
  oddsType: 'moneyline' | 'spread' | 'total';
  side: 'away' | 'home' | 'over' | 'under';
  odds: number;
  line?: number;
  startTime: number;
}

/** Bovada event ids are digit strings (e.g. "29514763"). */
const GAME_ID_RE = /^\d{1,20}$/;
const MAX_LEGS = 10;

const bad = (error: string) =>
  new Response(JSON.stringify({ error }), { status: 400, headers: { 'Content-Type': 'application/json' } });

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

    // Validate inputs. Everything below is checked for TYPE as well as value
    // (WOW-036 review): a gameId sent once as "123" and once as 123 used to pass
    // the one-leg-per-game check, and a stake of "abc" reached the debit script.
    if (!legs || !Array.isArray(legs) || legs.length === 0 || legs.length > MAX_LEGS) {
      return bad(`A bet needs between 1 and ${MAX_LEGS} legs.`);
    }
    if (typeof stake !== 'number' || !Number.isFinite(stake) || stake < 0.01 || stake > 1_000_000) {
      return bad('Stake must be between $0.01 and $1,000,000');
    }
    const stakeCents = Math.round(stake * 100);
    if (stakeCents < 1) return bad('Stake must be between $0.01 and $1,000,000');

    for (const leg of legs) {
      if (!leg || typeof leg !== 'object' || typeof leg.gameId !== 'string' || !GAME_ID_RE.test(leg.gameId)
        || typeof leg.oddsType !== 'string' || typeof leg.side !== 'string' || typeof leg.odds !== 'number' || !Number.isFinite(leg.odds)
        || (leg.line !== undefined && (typeof leg.line !== 'number' || !Number.isFinite(leg.line)))) {
        return bad('Invalid bet leg format');
      }
      if (!['moneyline', 'spread', 'total'].includes(leg.oddsType)) return bad('Invalid odds type');
      if (!['away', 'home', 'over', 'under'].includes(leg.side)) return bad('Invalid bet side');
      if (Math.abs(leg.odds) < 100) return bad('Invalid odds value');
    }

    // Price every leg from OUR lines, never the browser's (sportsbook-bet-check.ts):
    // the game must be on the board, not started, with recent lines, at the price
    // and point we hold right now. One leg per game, compared on the checked string.
    if (new Set(legs.map((l) => l.gameId)).size !== legs.length) {
      return bad('A parlay can have only one leg per game.');
    }
    // The stored legs are built ONLY from checked fields and the server's own
    // numbers; nothing else the browser sent is kept.
    const cleanLegs: StoredLeg[] = [];
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
      cleanLegs.push({
        gameId: leg.gameId,
        gameDescription: check.description,
        oddsType: leg.oddsType,
        side: leg.side,
        odds: check.odds,
        ...(check.line !== undefined ? { line: check.line } : {}),
        startTime: check.startTime,
      });
    }

    // Check user balance
    const currentBalance = await getBalance(user.id);

    if (currentBalance < stakeCents) {
      return bad('Insufficient balance');
    }

    // Debit balance atomically (Lua check-and-decrement). A concurrent bet can
    // still win the race; that surfaces as "Insufficient balance" below, a 400.
    const newBalance = await debitBalance(user.id, stakeCents);

    // Calculate implied odds for the bet (simplified parlay calculation)
    let decimalOdds = 1.0;
    for (const leg of cleanLegs) {
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
      type: cleanLegs.length === 1 ? 'single' : 'parlay',
      legs: cleanLegs,
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
      description: `${cleanLegs.length === 1 ? 'Single' : 'Parlay'} bet on ${cleanLegs.map((l) => l.gameDescription).join(' + ')}`,
      referenceId: betId,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        bet: {
          id: bet.id,
          type: bet.type,
          legCount: cleanLegs.length,
          stake: stakeCents / 100,
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
    if (String(err?.message ?? '').includes('Insufficient')) return bad('Insufficient balance');
    console.error('[Bet placement error]', err?.message);
    // No internal error text in the response (WOW-036 review finding 8).
    return new Response(JSON.stringify({ error: 'Failed to place bet' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
