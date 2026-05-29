// ── Step 176: /sitemap-zips-{state}.xml ────────────────────────────────
// Per-state ZIP shard. The `{state}` segment is the lowercase USPS
// abbreviation (e.g. `tx`, `ny`, `ca`). Unknown / empty shards return
// a 404 so Search Console doesn't crawl invented shards.

import type { APIRoute } from 'astro';
import {
  buildZipShardForState,
  listZipShardStates,
  renderUrlSet,
} from '../lib/seo/sitemap-shards';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const raw = (params.state ?? '').toString().toLowerCase();
  // Strip the trailing `.xml` if present (Astro typically removes it,
  // but be defensive against any router quirk).
  const stateLower = raw.replace(/\.xml$/, '');
  if (!stateLower || !/^[a-z]{2}$/.test(stateLower)) {
    return new Response('Not Found', { status: 404 });
  }
  const knownStates = new Set(listZipShardStates().map((s) => s.toLowerCase()));
  if (!knownStates.has(stateLower)) {
    return new Response('Not Found', { status: 404 });
  }
  const entries = buildZipShardForState(stateLower.toUpperCase());
  if (entries.length === 0) {
    return new Response('Not Found', { status: 404 });
  }
  return new Response(renderUrlSet(entries), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
