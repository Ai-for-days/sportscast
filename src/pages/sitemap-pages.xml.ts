// ── Step 176: /sitemap-pages.xml ───────────────────────────────────────
// Homepage + venues hub + league pages + map + historical.

import type { APIRoute } from 'astro';
import { buildPagesShard, renderUrlSet } from '../lib/seo/sitemap-shards';

export const prerender = false;

export const GET: APIRoute = async () => {
  const body = renderUrlSet(buildPagesShard());
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
