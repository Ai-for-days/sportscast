import type { APIRoute } from 'astro';
import { runAutoHvLPricingPass } from '../../../lib/auto-hvl-market';
import { runCrossVenuePricingPass, HVH_CONFIG, LVL_CONFIG } from '../../../lib/auto-cross-venue-market';
import { runVenueOUPricingPass } from '../../../lib/auto-venue-ou-market';

// Runs all four automated market-creation engines every 30 minutes (see
// vercel.json) — HvL was the original (2026-08-23); HvH, LvL, and the
// per-venue "Temp at Game Start" O/U were added 2026-08-25 per Derek,
// bundled into this same cron rather than a separate schedule since they
// sweep the identical game list. Each engine is independently
// dedup/claim-safe (see auto-market-shared.ts) and one engine's failure
// never blocks the others — they're awaited sequentially but wrapped so a
// thrown error from one still lets the rest run and reports in `errors`.

export const GET: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get('authorization');
  const cronSecret = import.meta.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results: Record<string, any> = {};
  const passes: [string, () => Promise<any>][] = [
    ['hvl', () => runAutoHvLPricingPass()],
    ['hvh', () => runCrossVenuePricingPass(HVH_CONFIG)],
    ['lvl', () => runCrossVenuePricingPass(LVL_CONFIG)],
    ['venueOU', () => runVenueOUPricingPass()],
  ];

  for (const [name, run] of passes) {
    try {
      results[name] = await run();
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
