// ── Public wager list API (sanitized) ───────────────────────────────────────
//
// Step 120 Part A: this endpoint serves customer-facing pages. Every
// response goes through listPublicWagers + serializePublicWagers so admin-
// only fields (voidReason, pricingSnapshot, lineHistory, internalName,
// opening/closing snapshots, etc.) are never sent to the browser.

import type { APIRoute } from 'astro';
import {
  listPublicWagers,
  serializePublicWagers,
} from '../../lib/public-wager-view';

// 2026-08-26, per Derek: this endpoint no longer takes a `status`. It used to
// accept open / locked / graded / void, which meant `?status=graded` handed
// the whole settled book to anyone who asked. Expired markets are admin-only
// now, so the route always serves current and future markets and nothing
// else. A `status` param is accepted and ignored rather than rejected, so an
// old bookmark or cached client degrades to the right answer instead of a 400.

export const GET: APIRoute = async ({ url }) => {
  try {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
    const cursor = parseInt(url.searchParams.get('cursor') || '0', 10) || 0;

    const { wagers, total } = await listPublicWagers({ limit, cursor });

    return new Response(JSON.stringify({ wagers: serializePublicWagers(wagers), total }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to fetch wagers' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
