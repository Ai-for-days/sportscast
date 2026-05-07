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
import type { WagerStatus } from '../../lib/wager-types';

const VALID_STATUSES: WagerStatus[] = ['open', 'locked', 'graded', 'void'];

export const GET: APIRoute = async ({ url }) => {
  try {
    const status = url.searchParams.get('status') as WagerStatus | null;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
    const cursor = parseInt(url.searchParams.get('cursor') || '0', 10) || 0;

    if (status && !VALID_STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: `Invalid status. Must be: ${VALID_STATUSES.join(', ')}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { wagers, total } = await listPublicWagers({
      status: status || undefined,
      limit,
      cursor,
    });

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
