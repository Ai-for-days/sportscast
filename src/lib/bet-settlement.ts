import { getWager } from './wager-store';
import { getWagerBets, updateBetStatus } from './bet-store';
import { creditBalance, getBalance, recordTransaction } from './wallet-store';
import type { Bet } from './bet-types';
import type { Wager } from './wager-types';

/**
 * Settle all pending bets for a graded wager.
 * - Win: outcomeLabel matches winningOutcome → credit potentialPayoutCents
 * - Push: winningOutcome is "push" or "none" → refund stake
 * - Loss: no credit
 */
export async function settleWagerBets(wagerId: string): Promise<{
  settled: number;
  won: number;
  lost: number;
  pushed: number;
  errors: string[];
}> {
  const result = { settled: 0, won: 0, lost: 0, pushed: 0, errors: [] as string[] };

  const wager = await getWager(wagerId);
  if (!wager || wager.status !== 'graded' || !wager.winningOutcome) {
    return result;
  }

  const bets = await getWagerBets(wagerId);
  const pendingBets = bets.filter(b => b.status === 'pending');

  for (const bet of pendingBets) {
    try {
      if (wager.winningOutcome === 'push' || wager.winningOutcome === 'none') {
        // Push — refund stake
        await settlePush(bet, wager);
        result.pushed++;
      } else if (bet.outcomeLabel === wager.winningOutcome) {
        // Win
        await settleWin(bet, wager);
        result.won++;
      } else {
        // Loss
        await updateBetStatus(bet.id, 'lost');
        result.lost++;
      }
      result.settled++;
    } catch (err: any) {
      result.errors.push(`Bet ${bet.id}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Refund all pending bets when a wager is voided.
 */
export async function settleVoidedWagerBets(wagerId: string): Promise<{
  refunded: number;
  errors: string[];
}> {
  const result = { refunded: 0, errors: [] as string[] };

  const bets = await getWagerBets(wagerId);
  const pendingBets = bets.filter(b => b.status === 'pending');

  for (const bet of pendingBets) {
    try {
      const newBalance = await creditBalance(bet.userId, bet.amountCents);
      await updateBetStatus(bet.id, 'void');
      await recordTransaction({
        userId: bet.userId,
        type: 'bet_refund',
        amountCents: bet.amountCents,
        balanceAfterCents: newBalance,
        description: `Refund: wager voided`,
        referenceId: bet.id,
      });
      result.refunded++;
    } catch (err: any) {
      result.errors.push(`Bet ${bet.id}: ${err.message}`);
    }
  }

  return result;
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function settleWin(bet: Bet, wager: Wager): Promise<void> {
  const newBalance = await creditBalance(bet.userId, bet.potentialPayoutCents);
  await updateBetStatus(bet.id, 'won');
  await recordTransaction({
    userId: bet.userId,
    type: 'bet_won',
    amountCents: bet.potentialPayoutCents,
    balanceAfterCents: newBalance,
    description: `Won $${(bet.potentialPayoutCents / 100).toFixed(2)} on "${wager.title}"`,
    referenceId: bet.id,
  });
}

async function settlePush(bet: Bet, wager: Wager): Promise<void> {
  const newBalance = await creditBalance(bet.userId, bet.amountCents);
  await updateBetStatus(bet.id, 'push');
  await recordTransaction({
    userId: bet.userId,
    type: 'bet_refund',
    amountCents: bet.amountCents,
    balanceAfterCents: newBalance,
    description: `Push: stake refunded on "${wager.title}"`,
    referenceId: bet.id,
  });
}
