// ── Step 176: /sitemap-cities.xml ──────────────────────────────────────
// Curated city hub roster (`CITY_HUB_ROSTER` in zip-priority.ts).

import type { APIRoute } from 'astro';
import { buildCitiesShard, renderUrlSet } from '../lib/seo/sitemap-shards';

export const prerender = false;

export const GET: APIRoute = async () => {
  const body = renderUrlSet(buildCitiesShard());
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
