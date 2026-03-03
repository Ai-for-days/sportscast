// ── Odds Utilities ───────────────────────────────────────────────────────────

/**
 * Calculate total payout (stake + profit) from American odds.
 * Positive odds: profit = stake * (odds / 100)
 * Negative odds: profit = stake * (100 / |odds|)
 */
export function calculatePayout(stakeCents: number, americanOdds: number): number {
  let profit: number;

  if (americanOdds > 0) {
    profit = stakeCents * (americanOdds / 100);
  } else {
    profit = stakeCents * (100 / Math.abs(americanOdds));
  }

  return Math.round(stakeCents + profit);
}

/**
 * Calculate required stake from desired profit and American odds.
 * Inverse of calculatePayout's profit calculation.
 */
export function calculateStakeFromProfit(profitCents: number, americanOdds: number): number {
  if (americanOdds > 0) {
    // profit = stake * (odds / 100) → stake = profit * 100 / odds
    return Math.round(profitCents * 100 / americanOdds);
  } else {
    // profit = stake * (100 / |odds|) → stake = profit * |odds| / 100
    return Math.round(profitCents * Math.abs(americanOdds) / 100);
  }
}
