// ── Step 176: SEO health snapshot ──────────────────────────────────────
//
// Pure aggregator that powers `/admin/system/seo-health`. Reads from
// the shared sitemap-shards helper + tier helper + noindex policy +
// canonical host constant. **No I/O, no secrets.** Designed to be
// regenerable on every page load.

import zipData from '../../data/us-zip-codes.json';
import {
  CANONICAL_HOST,
  buildCitiesShard,
  buildPagesShard,
  buildStatesShard,
  buildZipShardForState,
  listShardManifest,
  listZipShardStates,
  type ShardManifest,
} from './sitemap-shards';
import { countZipsByTier, type ZipRecord } from './zip-priority';
import { NOINDEX_ROUTE_GROUPS } from './noindex-policy';

export interface SeoHealthShard extends ShardManifest {
  /** Number of `<url>` entries emitted in the shard. */
  urlCount: number;
}

export interface SeoHealthSnapshot {
  generatedAt: string;
  canonicalHost: string;
  sitemapIndexUrl: string;
  shardCount: number;
  shards: SeoHealthShard[];
  totalSitemapUrls: number;
  hubCounts: {
    stateHubs: number;
    cityHubs: number;
    zipPages: number;
  };
  tierCounts: {
    tier1: number;
    tier2: number;
    tier3: number;
    total: number;
  };
  noIndexGroups: ReadonlyArray<{ prefix: string; reason: string }>;
}

export function buildSeoHealthSnapshot(): SeoHealthSnapshot {
  const manifest = listShardManifest();
  const shards: SeoHealthShard[] = manifest.map((m) => ({
    ...m,
    urlCount: urlCountFor(m),
  }));
  const totalSitemapUrls = shards.reduce((acc, s) => acc + s.urlCount, 0);

  const zips = zipData as ZipRecord[];
  const tierCounts = countZipsByTier(zips);

  const stateShard = buildStatesShard();
  const cityShard = buildCitiesShard();

  return {
    generatedAt: new Date().toISOString(),
    canonicalHost: CANONICAL_HOST,
    sitemapIndexUrl: `${CANONICAL_HOST}/sitemap-index.xml`,
    shardCount: shards.length,
    shards,
    totalSitemapUrls,
    hubCounts: {
      stateHubs: stateShard.length,
      cityHubs: cityShard.length,
      zipPages: zips.length,
    },
    tierCounts,
    noIndexGroups: NOINDEX_ROUTE_GROUPS.map((g) => ({
      prefix: g.prefix,
      reason: g.reason,
    })),
  };
}

function urlCountFor(m: ShardManifest): number {
  if (m.slug === 'pages') return buildPagesShard().length;
  if (m.slug === 'states') return buildStatesShard().length;
  if (m.slug === 'cities') return buildCitiesShard().length;
  if (m.slug.startsWith('zips-')) {
    const abbr = m.slug.slice('zips-'.length).toUpperCase();
    if (!listZipShardStates().includes(abbr)) return 0;
    return buildZipShardForState(abbr).length;
  }
  return 0;
}
