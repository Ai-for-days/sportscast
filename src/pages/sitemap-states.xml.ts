// ── Step 176: /sitemap-states.xml ──────────────────────────────────────
// 50 state hubs + DC.

import type { APIRoute } from 'astro';
import { buildStatesShard, renderUrlSet } from '../lib/seo/sitemap-shards';

export const prerender = false;

export const GET: APIRoute = async () => {
  const body = renderUrlSet(buildStatesShard());
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
