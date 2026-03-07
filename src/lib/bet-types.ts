// ── Bet Types ────────────────────────────────────────────────────────────────

import type { Wager } from './wager-types';

export type BetStatus = 'pending' | 'won' | 'lost' | 'push' | 'void';

export interface Bet {
  id: string;
  userId: string;
  wagerId: string;
  outcomeLabel: string;      // e.g. "60-62°F", "over", "locationA"
  odds: number;              // American odds at time of bet
  amountCents: number;       // stake
  potentialPayoutCents: number; // total payout (stake + profit) if bet wins
  status: BetStatus;
  createdAt: string;         // ISO 8601
  settledAt?: string;        // ISO 8601
}

/** Bet enriched with full wager details for display */
export interface EnrichedBet extends Bet {
  wager?: Wager;
}
