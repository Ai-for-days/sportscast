import type { APIRoute } from 'astro';
import { runAutoHvLPricingPass } from '../../../lib/auto-hvl-market';
import { runCrossVenuePricingPass, HVH_CONFIG, LVL_CONFIG } from '../../../lib/auto-cross-venue-market';
import { runVenueOUPricingPass } from '../../../lib/auto-venue-ou-market';

// Fixed 2026-08-25: the first production run of all 4 engines bundled into
// one invocation 504-timed-out 3 times in a row (confirmed via Vercel
// runtime logs), sweeping 4 leagues × 4 market types sequentially, each
// engine doing real per-game network calls (forecast fetch + NWS station
// resolve for any newly-created location), is roughly 4x a single engine's
// already-nontrivial runtime. HvL (first in the old sequential list) kept
// working since it completed before the timeout; HvH/LvL/venueOU never
// finished a single game before the function was killed, so nothing showed
// up on Weatherboard Extended despite the cron reporting no errors (the
// killed invocation's response never even made it back to the caller).
//
// Fix: each engine now runs as its OWN cron invocation, selected by
// `?only=`, on its own staggered schedule (see vercel.json) so no single
// request has to do more than one engine's worth of network I/O. The
// no-param path (run everything) is kept only for manual/local debugging;
// the actual cron schedule always passes `only`.

const ENGINES: Record<string, () => Promise<any>> = {
  hvl: () => runAutoHvLPricingPass(),
  hvh: () => runCrossVenuePricingPass(HVH_CONFIG),
  lvl: () => runCrossVenuePricingPass(LVL_CONFIG),
  venueOU: () => runVenueOUPricingPass(),
};

export const GET: APIRoute = async ({ request, url }) => {
  const authHeader = request.headers.get('authorization');
  const cronSecret = import.meta.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const only = url.searchParams.get('only');
  if (only && !ENGINES[only]) {
    return new Response(JSON.stringify({ error: `Unknown engine "${only}"`, validEngines: Object.keys(ENGINES) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const names = only ? [only] : Object.keys(ENGINES);
  const results: Record<string, any> = {};

  for (const name of names) {
    try {
      results[name] = await ENGINES[name]();
    } catch (err: any) {
      results[name] = { error: err?.message ?? 'unknown error' };
    }
  }

  const ok = Object.values(results).every((r) => !r.error);

  return new Response(JSON.stringify({
    ok,
    results,
    timestamp: new Date().toISOString(),
  }), {
    status: ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
};
