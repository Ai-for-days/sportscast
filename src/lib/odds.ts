// ── American odds <-> implied-probability conversions ──────────────────
//
// Kalshi (and most prediction markets) quote contracts in **cent
// prices** between 0 and 100, where the price equals the implied
// probability of the YES side resolving true. A Kalshi "yes_ask: 65"
// means the lowest sell offer is 65 cents per $1 contract, i.e. the
// market implies 65% probability.
//
// Sportsbooks (and Kalshi's consumer-facing UI) display the same
// information as **American odds**:
//   - A favorite at 65% probability shows as -186
//   - An underdog at 35% probability shows as +186
//
// These helpers are pure, server- + client-safe, no I/O.

/** Cent price (0–100) from Kalshi. `null` when missing or invalid. */
export type CentPrice = number | null | undefined;

/** American odds value. Positive for underdog, negative for favorite. */
export type AmericanOdds = number;

/**
 * Convert a Kalshi cent price (0–100) into American odds.
 *
 *   centsToAmericanOdds(65) === -186      // favorite
 *   centsToAmericanOdds(50) === 100       // even (conventionally +100)
 *   centsToAmericanOdds(35) === 186       // underdog
 *   centsToAmericanOdds(99)               // -9900 (extreme favorite)
 *   centsToAmericanOdds(0 | 100 | null) === null  (no market)
 */
export function centsToAmericanOdds(cents: CentPrice): AmericanOdds | null {
  if (cents == null) return null;
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
  if (cents <= 0 || cents >= 100) return null;
  if (cents === 50) return 100;
  if (cents > 50) {
    return Math.round((-100 * cents) / (100 - cents));
  }
  return Math.round((100 * (100 - cents)) / cents);
}

/**
 * Format American odds for display:
 *   formatAmericanOdds(-186)  === "-186"
 *   formatAmericanOdds(186)   === "+186"
 *   formatAmericanOdds(null)  === "—"
 */
export function formatAmericanOdds(odds: AmericanOdds | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return '—';
  if (odds >= 0) return `+${odds}`;
  return `${odds}`;
}

/**
 * Convenience: cent price -> formatted American odds string.
 *   formatCentsAsAmericanOdds(65) === "-186"
 *   formatCentsAsAmericanOdds(null) === "—"
 */
export function formatCentsAsAmericanOdds(cents: CentPrice): string {
  return formatAmericanOdds(centsToAmericanOdds(cents));
}

/**
 * Convert a Kalshi cent price into an implied probability (0–1).
 * Useful for analytics; the UI primarily uses American odds.
 */
export function centsToImpliedProbability(cents: CentPrice): number | null {
  if (cents == null) return null;
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
  if (cents < 0 || cents > 100) return null;
  return cents / 100;
}
