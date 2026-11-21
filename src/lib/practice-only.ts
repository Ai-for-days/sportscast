// Wager on Weather is practice play only (WOW-036, 2026-11-20).
//
// The site still carried card deposits (Stripe Checkout, $5-$500 into the same
// wallet as the play money) and withdrawal requests from an old real-money
// design. With the owner about to add outside players, a player could have asked
// to "withdraw" $100,000 of play money, and a live Stripe key would make this
// real-money betting. Both endpoints now refuse on the server, before any Stripe
// call, balance change or Redis write, and the buttons are hidden.
//
// /api/payments/webhook is deliberately unchanged: it credits only Stripe-signed
// events, so a real payment, if one ever happened, is still recorded.

export const PAYMENTS_ENABLED = false;

/**
 * Betting on the Bovada game lines (/api/bets/place) is paused until results
 * grading exists (WOW-036 HIGH; DBD 2026-11-20 "yes on betting opens once grading
 * is live"; WOW-039 A). Those bets took the stake and never paid out. A code
 * constant, not an env var: turning it back on is a reviewed code change.
 * Weather wagers (/api/bets) are not affected.
 */
export const SPORTSBOOK_BETTING_OPEN = false;
export const SPORTSBOOK_PAUSED_ERROR = 'Game-line betting opens once results grading is live.';

let testOverride: boolean | null = null;
/** Whether /api/bets/place accepts bets: the constant, unless a test overrides it. */
export function sportsbookBettingOpen(): boolean {
  return testOverride ?? SPORTSBOOK_BETTING_OPEN;
}
/**
 * Tests only: open the sportsbook so the price checks behind the gate can still
 * be tested. Pass null to restore the constant. Never called by application code.
 */
export function setSportsbookOpenForTests(open: boolean | null): void {
  testOverride = open;
}
export const PRACTICE_ONLY_ERROR = 'Wager on Weather is practice play only.';

export function practiceOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: PRACTICE_ONLY_ERROR }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
