// ── WOW-032 S2: /sitemap-games.xml ──────────────────────────────────────
// Frozen, indexable NFL and college-football game pages, each with
// lastmod = the record's frozenAt (a stored, true date). Read from one small
// sorted set per league (gamerec:sitemap:<league>), never from the records.
// MLB and MLS game pages are not listed (WOW-031 4).

import type { APIRoute } from 'astro';
import { buildGamesShard, renderUrlSet } from '../lib/seo/sitemap-shards';
import { getSitemapGameEntries } from '../lib/game-record-store';
import { GAME_SITEMAP_LEAGUES } from '../lib/game-record';

export const prerender = false;

export const GET: APIRoute = async () => {
  let entries: { path: string; lastmod: string }[] = [];
  try {
    entries = await getSitemapGameEntries(GAME_SITEMAP_LEAGUES);
  } catch {
    entries = [];
  }
  const body = renderUrlSet(buildGamesShard(entries));
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
