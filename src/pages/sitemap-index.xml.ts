// ── Step 176: /sitemap-index.xml ───────────────────────────────────────
// Custom replacement for `@astrojs/sitemap`'s auto-named output. Lists
// every semantic shard so Google Search Console can inspect by
// category (pages / states / cities / per-state ZIPs).

import type { APIRoute } from 'astro';
import { listShardManifest, renderSitemapIndex } from '../lib/seo/sitemap-shards';

export const prerender = false;

export const GET: APIRoute = async () => {
  const manifest = listShardManifest();
  const body = renderSitemapIndex(manifest, new Date().toISOString());
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
