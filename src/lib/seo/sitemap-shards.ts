// ── Step 176: Sitemap shard definitions ─────────────────────────────────
//
// Source of truth for which URLs land in which sitemap shard. Used by:
//   - `src/pages/sitemap-index.xml.ts` (lists every child sitemap)
//   - `src/pages/sitemap-pages.xml.ts` (homepage + venues + map + historical)
//   - `src/pages/sitemap-states.xml.ts` (51 state hubs)
//   - `src/pages/sitemap-cities.xml.ts` (curated city hubs)
//   - `src/pages/sitemap-zips-[state].xml.ts` (per-state ZIP shards)
//   - `src/lib/seo/seo-health.ts` (admin SEO health dashboard)
//
// Pure: builds URL lists from imported data. **Never throws.** All
// emitted URLs are non-www absolute against `https://wageronweather.com`.

import zipData from '../../data/us-zip-codes.json';
import { STATE_ABBR_TO_FULL, stateAbbrToSlug } from '../state-names';
import {
  CITY_HUB_ROSTER,
  getZipPriorityTier,
  sortZipPagesByPriority,
  type ZipRecord,
} from './zip-priority';
import { isNoIndexPathname } from './noindex-policy';
import { venues } from '../venue-data';

export const CANONICAL_HOST = 'https://wageronweather.com';

/** Shard slug used in URLs (`/sitemap-{slug}.xml`). */
export type ShardSlug =
  | 'pages'
  | 'states'
  | 'cities'
  | `zips-${string}`;

export interface SitemapUrlEntry {
  loc: string;
  /** ISO timestamp used for `<lastmod>`. */
  lastmod?: string;
  /** Sitemap priority (0.0–1.0). */
  priority?: number;
  /** Sitemap change frequency. */
  changefreq?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
}

export interface ShardManifest {
  slug: ShardSlug;
  /** Human-readable shard name for the admin dashboard. */
  label: string;
  /** Full URL of the child sitemap on the canonical host. */
  url: string;
}

const ZIP_LIST = zipData as ZipRecord[];

// Step 178: crawl-budget concentration. After ~5 months live with all
// ~41k ZIPs in the sitemap, Google indexed only ~38 pages and left the
// long tail as "Discovered/Crawled – currently not indexed". We now only
// advertise Tier 1 (priority / city-hub / major-metro) and Tier 2
// (mid-tier curated city) ZIPs in the sitemap — the ~2,815 + ~3,412 =
// ~6,227 ZIPs in genuinely named cities. Tier 3 (~34,743 long-tail ZIPs)
// stays live and crawlable but is no longer force-fed to Google, so
// crawl budget concentrates on pages that can realistically index/rank.
// GSC impression data can later promote a Tier-3 ZIP into the sitemap
// (add it to priority-zip-content.ts / a city hub / us-cities.ts).
const MAX_SITEMAP_ZIP_TIER = 2;

// ── Static shards ──────────────────────────────────────────────────────

/** Pages shard: homepage, venues hub, league pages, map, historical. */
export function buildPagesShard(): SitemapUrlEntry[] {
  const entries: SitemapUrlEntry[] = [
    { loc: `${CANONICAL_HOST}/`, priority: 1.0, changefreq: 'daily' },
    { loc: `${CANONICAL_HOST}/venues`, priority: 0.9, changefreq: 'weekly' },
    { loc: `${CANONICAL_HOST}/venues/mlb`, priority: 0.8, changefreq: 'weekly' },
    { loc: `${CANONICAL_HOST}/venues/nfl`, priority: 0.8, changefreq: 'weekly' },
    { loc: `${CANONICAL_HOST}/venues/ncaa-football`, priority: 0.8, changefreq: 'weekly' },
    { loc: `${CANONICAL_HOST}/venues/mls`, priority: 0.8, changefreq: 'weekly' },
    { loc: `${CANONICAL_HOST}/venues/community`, priority: 0.8, changefreq: 'weekly' },
    { loc: `${CANONICAL_HOST}/map`, priority: 0.7, changefreq: 'daily' },
    { loc: `${CANONICAL_HOST}/historical`, priority: 0.6, changefreq: 'monthly' },
    // Step 180: individual venue game-day-weather pages (now real destinations,
    // no longer redirects to ZIP pages) — the niche/venue SEO surface.
    ...venues.map((v) => ({
      loc: `${CANONICAL_HOST}/venues/${v.id}`,
      priority: 0.6,
      changefreq: 'weekly' as const,
    })),
  ];
  // Belt-and-suspenders: every URL must be a non-www, non-noindex path.
  return entries.filter((e) => isClean(e.loc));
}

/** States shard: every US state, DC, and Canadian-province slug (51). */
export function buildStatesShard(): SitemapUrlEntry[] {
  const seen = new Set<string>();
  const out: SitemapUrlEntry[] = [];
  // Only emit US state slugs that match the public hub routing. PR and
  // CA provinces are intentionally excluded — there is no public hub
  // page for them yet.
  for (const abbr of US_STATE_ABBRS) {
    const slug = STATE_ABBR_TO_FULL[abbr];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const loc = `${CANONICAL_HOST}/weather/${slug}`;
    if (isClean(loc)) {
      out.push({ loc, priority: 0.7, changefreq: 'hourly' });
    }
  }
  return out;
}

/** Cities shard: curated city hub roster. */
export function buildCitiesShard(): SitemapUrlEntry[] {
  const out: SitemapUrlEntry[] = [];
  for (const hub of CITY_HUB_ROSTER) {
    const stateSlug = stateAbbrToSlug(hub.state);
    const citySlug = toSlug(hub.city);
    if (!stateSlug || !citySlug) continue;
    const loc = `${CANONICAL_HOST}/weather/${stateSlug}/${citySlug}`;
    if (isClean(loc)) {
      out.push({ loc, priority: 0.75, changefreq: 'hourly' });
    }
  }
  return out;
}

// ── Per-state ZIP shards ───────────────────────────────────────────────

/** All state abbreviations that have at least one ZIP in the dataset. */
export function listZipShardStates(): string[] {
  const seen = new Set<string>();
  for (const z of ZIP_LIST) {
    if (z.s) seen.add(z.s.toUpperCase());
  }
  return Array.from(seen).sort();
}

/** Build the ZIP shard for a single state. */
export function buildZipShardForState(stateAbbr: string): SitemapUrlEntry[] {
  const stateClean = stateAbbr.toUpperCase();
  const stateSlug = stateAbbrToSlug(stateClean);
  if (!stateSlug) return [];
  // Only advertise Tier 1 + Tier 2 ZIPs (see MAX_SITEMAP_ZIP_TIER). The
  // Tier-3 long tail stays live/crawlable but out of the sitemap.
  const subset = ZIP_LIST.filter(
    (z) => z.s === stateClean && getZipPriorityTier(z) <= MAX_SITEMAP_ZIP_TIER,
  );
  // Tier-1 ZIPs at the top of every shard so when GSC samples the
  // first N URLs from a shard it sees the highest-quality candidates.
  const sorted = sortZipPagesByPriority(subset);
  const out: SitemapUrlEntry[] = [];
  for (const z of sorted) {
    const citySlugClean = toSlug(z.c);
    const path = citySlugClean
      ? `/united-states-${stateSlug}-${citySlugClean}-${z.z}`
      : `/united-states-${stateSlug}-${z.z}`;
    const loc = `${CANONICAL_HOST}${path}`;
    if (isClean(loc)) {
      out.push({ loc, priority: 0.5, changefreq: 'hourly' });
    }
  }
  return out;
}

// ── Manifest (sitemap-index.xml) ───────────────────────────────────────

/** Every shard the index references, in stable order. Pure. */
export function listShardManifest(): ShardManifest[] {
  const manifest: ShardManifest[] = [
    { slug: 'pages', label: 'Pages', url: `${CANONICAL_HOST}/sitemap-pages.xml` },
    { slug: 'states', label: 'State hubs', url: `${CANONICAL_HOST}/sitemap-states.xml` },
    { slug: 'cities', label: 'City hubs', url: `${CANONICAL_HOST}/sitemap-cities.xml` },
  ];
  for (const stateAbbr of listZipShardStates()) {
    const slug = `zips-${stateAbbr.toLowerCase()}` as const;
    manifest.push({
      slug,
      label: `ZIPs (${stateAbbr})`,
      url: `${CANONICAL_HOST}/sitemap-${slug}.xml`,
    });
  }
  return manifest;
}

// ── Pathname → shard URL (Step 177 reconciler) ─────────────────────────

/**
 * Pure pathname → child-sitemap URL classifier. Returns `undefined` for
 * paths that don't belong in any shard (admin, API, auth, account,
 * dashboard, settings, preview, internal, coord-fallback, etc.).
 *
 * Used by `src/lib/seo/gsc-import.ts` to attach a `sitemapShard` URL
 * to every reconciled GSC row so the dashboard can answer "which shard
 * is producing 'crawled, not indexed'?".
 */
export function assignSitemapShard(pathname: string): string | undefined {
  if (!pathname || typeof pathname !== 'string') return undefined;
  const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Belt-and-suspenders: never emit a shard for any noindex / private
  // route group.
  if (isNoIndexPathname(p)) return undefined;
  if (p.startsWith('/api/')) return undefined;

  if (p === '' || p === '/') return `${CANONICAL_HOST}/sitemap-pages.xml`;
  if (p === '/venues' || p.startsWith('/venues/')) {
    return `${CANONICAL_HOST}/sitemap-pages.xml`;
  }
  if (p === '/map' || p === '/historical') {
    return `${CANONICAL_HOST}/sitemap-pages.xml`;
  }
  if (p.startsWith('/weather/')) {
    const depth = p.split('/').filter(Boolean).length;
    if (depth === 2) return `${CANONICAL_HOST}/sitemap-states.xml`;
    if (depth === 3) return `${CANONICAL_HOST}/sitemap-cities.xml`;
    return undefined;
  }
  if (/^\/united-states-/.test(p)) {
    // Pull the state slug between `united-states-` and the trailing
    // `-{zip}`; map to its USPS abbreviation via STATE_ABBR_TO_FULL
    // inverse lookup.
    const stateAbbr = stateAbbrFromZipPath(p);
    if (!stateAbbr) return undefined;
    return `${CANONICAL_HOST}/sitemap-zips-${stateAbbr.toLowerCase()}.xml`;
  }
  return undefined;
}

const SLUG_TO_ABBR: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [abbr, slug] of Object.entries(STATE_ABBR_TO_FULL)) {
    out[slug] = abbr;
  }
  return out;
})();

function stateAbbrFromZipPath(p: string): string | undefined {
  // p looks like `/united-states-{state-slug}-{city-slug}-{zip}` or
  // `/united-states-{state-slug}-{zip}`. The state slug can be
  // multiple `-` words (e.g. `new-york`, `district-of-columbia`).
  // Drop the leading prefix + trailing ZIP first, then iterate
  // increasingly long prefixes against the known slug map.
  const trimmed = p.replace(/^\/united-states-/, '').replace(/-\d{5}$/, '');
  if (!trimmed) return undefined;
  const parts = trimmed.split('-');
  // State slugs are at most 4 parts (`district-of-columbia`).
  for (let take = Math.min(parts.length, 4); take >= 1; take -= 1) {
    const candidate = parts.slice(0, take).join('-');
    if (SLUG_TO_ABBR[candidate]) return SLUG_TO_ABBR[candidate];
  }
  return undefined;
}

// ── XML serialization ──────────────────────────────────────────────────

export function renderUrlSet(entries: SitemapUrlEntry[]): string {
  const body = entries
    .map((e) => {
      const parts = [
        `<url>`,
        `<loc>${escapeXml(e.loc)}</loc>`,
      ];
      if (e.lastmod) parts.push(`<lastmod>${escapeXml(e.lastmod)}</lastmod>`);
      if (typeof e.priority === 'number') parts.push(`<priority>${e.priority.toFixed(2)}</priority>`);
      if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
      parts.push(`</url>`);
      return parts.join('');
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(manifest: ShardManifest[], lastmod: string): string {
  const body = manifest
    .map(
      (m) =>
        `<sitemap><loc>${escapeXml(m.url)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></sitemap>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

// ── Internal helpers ───────────────────────────────────────────────────

/** True iff the URL is non-www and not in any noindex route group. */
function isClean(loc: string): boolean {
  if (!loc.startsWith(`${CANONICAL_HOST}/`) && loc !== CANONICAL_HOST) return false;
  if (loc.includes('//www.')) return false;
  const pathname = loc.slice(CANONICAL_HOST.length) || '/';
  if (isNoIndexPathname(pathname)) return false;
  if (pathname.startsWith('/api/')) return false;
  return true;
}

function toSlug(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 50 states + DC. Source of truth for which slugs appear in the
 *  states shard. Excludes territories + Canadian provinces (no public
 *  hub for those yet). */
const US_STATE_ABBRS: ReadonlyArray<string> = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

