import { getWagerBets } from './bet-store';
import type { Bet } from './bet-types';

export interface WagerExposure {
  wagerId: string;
  totalBets: number;
  totalStakedCents: number;
  maxLiabilityCents: number;
  byOutcome: Record<string, {
    betCount: number;
    stakedCents: number;
    maxPayoutCents: number;
  }>;
}

/**
 * Calculate exposure for a wager: total staked, max liability by outcome.
 * Max liability = sum of all potential payouts for the worst-case outcome.
 */
export async function getWagerExposure(wagerId: string): Promise<WagerExposure> {
  const bets = await getWagerBets(wagerId);
  const pendingBets = bets.filter(b => b.status === 'pending');

  const byOutcome: Record<string, { betCount: number; stakedCents: number; maxPayoutCents: number }> = {};

  let totalStakedCents = 0;

  for (const bet of pendingBets) {
    totalStakedCents += bet.amountCents;

    if (!byOutcome[bet.outcomeLabel]) {
      byOutcome[bet.outcomeLabel] = { betCount: 0, stakedCents: 0, maxPayoutCents: 0 };
    }
    byOutcome[bet.outcomeLabel].betCount++;
    byOutcome[bet.outcomeLabel].stakedCents += bet.amountCents;
    byOutcome[bet.outcomeLabel].maxPayoutCents += bet.potentialPayoutCents;
  }

  // Max liability = worst-case NET loss for the house.
  // For each outcome: if it wins, house pays out that outcome's total payout
  // but keeps all stakes (including losers). Net loss = payout - totalStaked.
  // If negative (house profits), liability is 0.
  let maxLiabilityCents = 0;
  for (const outcome of Object.values(byOutcome)) {
    const netLoss = outcome.maxPayoutCents - totalStakedCents;
    if (netLoss > maxLiabilityCents) {
      maxLiabilityCents = netLoss;
    }
  }

  return {
    wagerId,
    totalBets: pendingBets.length,
    totalStakedCents,
    maxLiabilityCents,
    byOutcome,
  };
}
