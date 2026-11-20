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
export const PRACTICE_ONLY_ERROR = 'Wager on Weather is practice play only.';

export function practiceOnlyResponse(): Response {
  return new Response(JSON.stringify({ error: PRACTICE_ONLY_ERROR }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
