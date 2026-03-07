import { getWager } from './wager-store';
import { getWagerBets, updateBetStatus } from './bet-store';
import { creditBalance, getBalance, recordTransaction } from './wallet-store';
import { creditBankroll, debitBankroll } from './bookmaker-store';
import type { Bet } from './bet-types';
import type { Wager } from './wager-types';

/**
 * Escrow model settlement:
 * - Player's stake is already deducted from their balance (held in escrow).
 * - Win: player gets stake back + profit. Profit comes from bookmaker bankroll.
 * - Loss: player's escrowed stake goes to bookmaker bankroll.
 * - Push: player gets stake back (returned from escrow). No bankroll change.
 * - Void: same as push — stake returned from escrow.
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
      if (wager.winningOutcome === 'push') {
        // Push — return escrowed stake to player
        await settlePush(bet, wager);
        result.pushed++;
      } else if (wager.winningOutcome === 'no_match' || wager.winningOutcome === 'none') {
        // No outcome range matched — all bets lose (not a push)
        await settleLoss(bet, wager);
        result.lost++;
      } else if (bet.outcomeLabel === wager.winningOutcome) {
        // Win — return stake + pay profit from bankroll
        await settleWin(bet, wager);
        result.won++;
      } else {
        // Loss — escrowed stake goes to bookmaker bankroll
        await settleLoss(bet, wager);
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
 * Escrowed stake returned to player. No bankroll change.
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
      // Return escrowed stake to player
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
  const profitCents = bet.potentialPayoutCents - bet.amountCents;

  // Profit comes from bookmaker bankroll
  if (profitCents > 0) {
    await debitBankroll(profitCents);
  }

  // Return stake (from escrow) + profit to player
  const newBalance = await creditBalance(bet.userId, bet.potentialPayoutCents);
  await updateBetStatus(bet.id, 'won');
  await recordTransaction({
    userId: bet.userId,
    type: 'bet_won',
    amountCents: bet.potentialPayoutCents,
    balanceAfterCents: newBalance,
    description: `Won $${(profitCents / 100).toFixed(2)} profit on "${wager.title}" (+ $${(bet.amountCents / 100).toFixed(2)} stake returned)`,
    referenceId: bet.id,
  });
}

async function settleLoss(bet: Bet, wager: Wager): Promise<void> {
  // Player's escrowed stake goes to bookmaker bankroll
  await creditBankroll(bet.amountCents);
  await updateBetStatus(bet.id, 'lost');
  const currentBalance = await getBalance(bet.userId);
  await recordTransaction({
    userId: bet.userId,
    type: 'bet_lost',
    amountCents: -bet.amountCents,
    balanceAfterCents: currentBalance,
    description: `Lost bet on "${wager.title}" — $${(bet.amountCents / 100).toFixed(2)} forfeited`,
    referenceId: bet.id,
  });
}

async function settlePush(bet: Bet, wager: Wager): Promise<void> {
  // Return escrowed stake to player. No bankroll change.
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
