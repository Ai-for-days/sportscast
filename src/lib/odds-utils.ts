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
