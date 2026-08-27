// ── Lock-only sweep cron (2026-08-27, per Derek) ───────────────────────────
//
// Flips open wagers whose lock time has passed to `locked`. That is the whole
// job. It does NOT grade, does NOT settle, does NOT touch a wallet, and does
// not import anything that could.
//
// Why it exists: the same flip already runs inside /api/cron/grade-wagers, but
// that cron fires once a day at 07:00 UTC (3 AM ET) and also grades outcomes
// and settles bets, which moves real money. So it cannot simply be run more
// often. Splitting the harmless half out lets the stored status track reality
// within half an hour while the money half stays on its once-a-day schedule,
// untouched.
//
// Nothing customer-facing depends on this being prompt: every public surface
// compares the clock to the wager's own lockTime on each read
// (isPubliclyVisible in public-wager-view.ts), so a market past its lock time
// is unbettable the instant it expires whether or not this has run. What the
// lag actually cost was bookkeeping accuracy: an inflated "open" count, an
// Open tab full of markets that had really closed, and a closing-line snapshot
// captured hours after the line actually closed.
//
// Safe to run as often as the schedule allows: it is idempotent, and a wager
// an operator locked by hand in the meantime is simply skipped.

import type { APIRoute } from 'astro';
import { lockExpiredWagers } from '../../../lib/wager-store';

export const GET: APIRoute = async ({ request }) => {
  // Same cron-secret check as the other cron routes. Vercel sends it as an
  // Authorization header; when CRON_SECRET is unset (local dev) it is skipped.
  const authHeader = request.headers.get('authorization');
  const cronSecret = import.meta.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const locked = await lockExpiredWagers();

    return new Response(JSON.stringify({
      ok: true,
      locked: locked.length,
      lockedIds: locked,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? 'Lock sweep failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
