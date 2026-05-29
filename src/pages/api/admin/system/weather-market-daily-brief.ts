// ── Step 159: Admin-only daily market brief API ─────────────────────────
//
// Read-only aggregation endpoint that returns a compact operational
// summary of the weather-market workflow (saved ideas + drafts + QA +
// risk warnings + feedback). **Admin-gated. No mutation. No public
// surface.** Failures inside individual subsystem reads are caught by
// the aggregator and surfaced via `subsystemStatus` so the brief still
// partially renders if one subsystem is down.

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { buildDailyBrief } from '../../../../lib/weather-market-daily-brief';

export const prerender = false;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Admin diagnostic — always fresh. Previous 30s browser cache
      // was producing stale "no Kalshi climate snapshot" responses
      // after operators captured a fresh snapshot.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const brief = await buildDailyBrief();
    return jsonResponse({ brief });
  } catch (err: any) {
    // Aggregator already swallows per-subsystem failures; this catch
    // exists for completely-unexpected failures (e.g. import-time
    // throw). Degrade to a still-shaped error envelope.
    return jsonResponse(
      { error: 'daily_brief_failed', message: err?.message ?? String(err) },
      500,
    );
  }
};
