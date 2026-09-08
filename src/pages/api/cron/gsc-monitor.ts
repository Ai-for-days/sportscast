// ── Weekly Search Console pull (2026-09-08, per Derek) ────────────────────
//
// Takes the measurement nobody was taking. See gsc-monitor.ts for what it
// alerts on and, more importantly, what it deliberately does not: search data
// at this site's volume is noisy enough that a naive percentage alarm would
// fire most weeks and then be muted, taking the real one with it.
//
// Weekly rather than daily on purpose. The window is 28 days and Search
// Console finalises on a roughly 3-day lag, so consecutive daily snapshots
// would overlap by 27 days and mostly measure the same thing twice.
//
// Read-only against Search Console: the credential is requested with
// `webmasters.readonly`, so this cannot submit a sitemap or request indexing.

import type { APIRoute } from 'astro';
import { runGscMonitor } from '../../../lib/seo/gsc-monitor';

export const GET: APIRoute = async ({ request }) => {
  // Same cron-secret check as the other cron routes.
  const authHeader = request.headers.get('authorization');
  const cronSecret = import.meta.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await runGscMonitor();
    return new Response(JSON.stringify({
      ...result,
      // The pages array is long and the point of the response is the verdict;
      // the full snapshot is on /admin/system/seo-health.
      snapshot: result.snapshot
        ? {
            takenAt: result.snapshot.takenAt,
            windowDays: result.snapshot.windowDays,
            totals: result.snapshot.totals,
            pagesWithImpressions: result.snapshot.pages.filter((p) => p.impressions > 0).length,
            topPages: result.snapshot.pages.slice(0, 10),
          }
        : undefined,
      timestamp: new Date().toISOString(),
    }), {
      status: result.ok ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message ?? 'GSC monitor failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
