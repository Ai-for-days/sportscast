#!/usr/bin/env node
// ── Step 174 / 175 / 176 / 188: SEO routing verification script ─────────
//
// Also runs as `npm run seo:audit` (package.json). Step 176 broadened
// coverage to the sharded sitemap-index + every shard. Step 188 (the
// ZIP-indexability recovery architecture) adds: non-allowlisted ZIPs
// must render `noindex, follow` (not indexed, but still crawlable so
// Google reaches hub/allowlisted pages through their links); no
// sitemap-listed URL may carry noindex; sitemap URLs must have a
// self-referencing canonical and not redirect; the legacy duplicate ZIP
// URL format must 301 to the canonical format EXCEPT the one
// GSC-already-indexed exception (Cincinnati 45221); the sports-weather
// hub links must be real, working, and linked from the homepage.
//
// Run from a deploy preview or production URL — local dev does NOT
// exercise the Vercel host-based 301 redirect.
//
// Usage:
//   node scripts/verify-seo-routing.mjs                       # defaults to https://wageronweather.com
//   node scripts/verify-seo-routing.mjs --base https://wageronweather.com
//   node scripts/verify-seo-routing.mjs --base https://wageronweather.com --quiet
//   npm run seo:audit                                         # same, via package.json
//
// Exit code 0 on all-pass, 1 on any failure.

import indexableLocationsData from '../src/data/seo-indexable-locations.json' with { type: 'json' };

const ARGS = process.argv.slice(2);
let BASE = 'https://wageronweather.com';
let QUIET = false;
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] === '--base' && ARGS[i + 1]) {
    BASE = ARGS[i + 1].replace(/\/+$/, '');
    i += 1;
  } else if (ARGS[i] === '--quiet') {
    QUIET = true;
  }
}

const NON_WWW_HOST = 'https://wageronweather.com';
const WWW_HOST = 'https://www.wageronweather.com';

// ── Step 176: representative route categories ─────────────────────────────

const HOMEPAGE_PATHS = ['/'];

const STATE_HUB_PATHS = [
  '/weather/texas',
  '/weather/new-york',
  '/weather/california',
  '/weather/minnesota',
  '/weather/oklahoma',
  '/weather/florida',
  '/weather/illinois',
  '/weather/ohio',
];

const CITY_HUB_PATHS = [
  '/weather/texas/dallas',
  '/weather/texas/houston',
  '/weather/new-york/new-york',
  '/weather/minnesota/saint-paul',
  '/weather/oklahoma/oklahoma-city',
];

// Step 188 — sourced directly from the allowlist file, not duplicated by
// hand, so this script can never silently drift from what
// shouldIndexLocationPage() actually allows.
const PRIORITY_ZIP_PATHS = indexableLocationsData.locations.map((l) => l.urlPath);
const CINCINNATI_LEGACY_PATH = '/united-states-45221-cincinnati-ohio';

// ≥25 Tier-2/3 sample ZIPs across diverse states — deliberately NOT on
// the allowlist. Step 188: these must now render `noindex, follow` and
// must be absent from every sitemap shard. These are real ZIPs from the
// dataset.
const NON_PRIORITY_ZIP_PATHS = [
  '/united-states-california-los-angeles-90001',
  '/united-states-illinois-chicago-60601',
  '/united-states-florida-miami-33101',
  '/united-states-washington-seattle-98101',
  // 02108, not 02101 — 02101-02107 are Boston's "unique" ZIPs (assigned
  // to specific buildings/PO boxes, not delivery areas) and are absent
  // from this app's local dataset. Confirmed a real, if narrow, dataset
  // gap while implementing the authoritative-dataset-only geocoding fix
  // (see docs/geocode-authoritative fix notes) — 02108 is a genuine,
  // present ZIP so it stays a valid "non-allowlisted ZIP" sample.
  '/united-states-massachusetts-boston-02108',
  '/united-states-georgia-atlanta-30301',
  '/united-states-pennsylvania-philadelphia-19101',
  '/united-states-arizona-phoenix-85001',
  '/united-states-colorado-denver-80201',
  '/united-states-tennessee-nashville-37201',
  '/united-states-ohio-columbus-43201',
  '/united-states-michigan-detroit-48201',
  '/united-states-north-carolina-charlotte-28201',
  '/united-states-indiana-indianapolis-46201',
  '/united-states-virginia-richmond-23218',
  '/united-states-louisiana-new-orleans-70112',
  '/united-states-oregon-portland-97201',
  '/united-states-nevada-las-vegas-89101',
  '/united-states-wisconsin-milwaukee-53201',
  '/united-states-missouri-saint-louis-63101',
  '/united-states-kentucky-louisville-40201',
  '/united-states-maryland-baltimore-21201',
  '/united-states-utah-salt-lake-city-84101',
  '/united-states-new-mexico-albuquerque-87101',
  '/united-states-iowa-des-moines-50301',
];

// Step 188 — real, working pages the site now links to from the
// persistent header nav, not just the homepage card row.
const SPORTS_HUB_PATHS = ['/nfl-weather', '/mlb-weather', '/college-football-weather'];

const NOINDEX_PATHS = [
  '/admin',
  '/api/admin/system/weathernext-probe',
  '/login',
  '/signup',
  '/account',
  '/dashboard',
];

// Step 188 — non-allowlisted ZIPs are noindex,FOLLOW, not admin-style
// noindex,nofollow. Checked separately from NOINDEX_PATHS below.
const NOINDEX_FOLLOW_PATHS = [...NON_PRIORITY_ZIP_PATHS];

const INDEXABLE_PATHS = [
  ...HOMEPAGE_PATHS,
  ...STATE_HUB_PATHS,
  ...CITY_HUB_PATHS,
  ...PRIORITY_ZIP_PATHS,
  ...SPORTS_HUB_PATHS,
];

const ZIP_PATHS = [...PRIORITY_ZIP_PATHS, ...NON_PRIORITY_ZIP_PATHS];
const HUB_PATHS = [...STATE_HUB_PATHS, ...CITY_HUB_PATHS];
const ALL_PATHS = [...INDEXABLE_PATHS, ...NOINDEX_PATHS, ...NOINDEX_FOLLOW_PATHS];

const SITEMAP_INDEX = `${BASE}/sitemap-index.xml`;

// Expected top-level shard slugs that the index must reference.
const EXPECTED_TOP_LEVEL_SHARDS = [
  '/sitemap-pages.xml',
  '/sitemap-states.xml',
  '/sitemap-cities.xml',
];
// Expected per-state ZIP shard slugs. Step 188 — derived from the actual
// allowlist states, since the sitemap index now only lists shards that
// have at least one indexable ZIP (see `listShardManifest()` in
// sitemap-shards.ts — an empty shard 404s, so it must not be listed).
// Most of the other ~46 states will have NO ZIP shard at all now, by
// design — that's the point of Step 188, not a bug.
const EXPECTED_STATE_ZIP_SHARDS = Array.from(
  new Set(indexableLocationsData.locations.map((l) => `/sitemap-zips-${l.stateAbbr.toLowerCase()}.xml`)),
);

// ── Result recorder ────────────────────────────────────────────────────

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  if (QUIET) return;
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${label}${detail ? `  · ${detail}` : ''}`);
}

async function fetchText(url, options = {}) {
  const r = await fetch(url, { redirect: 'manual', ...options });
  let body = '';
  try {
    body = await r.text();
  } catch {
    /* swallow */
  }
  return { status: r.status, headers: r.headers, body };
}

// ── 1. www → non-www redirects ─────────────────────────────────────────────

async function checkWwwRedirect(pathname) {
  const url = `${WWW_HOST}${pathname}`;
  try {
    const { status, headers } = await fetchText(url);
    const location = headers.get('location') || '';
    const ok = status >= 300 && status < 400 && location.startsWith(`${NON_WWW_HOST}${pathname}`);
    record(
      `301 ${url} → ${NON_WWW_HOST}${pathname}`,
      ok,
      ok ? `status=${status}` : `status=${status}, location=${location.slice(0, 96)}`,
    );
  } catch (err) {
    record(`301 ${url}`, false, `fetch_error: ${err?.message ?? err}`);
  }
}

// ── 2. canonical + OG/Twitter + no www in HTML ──────────────────────────

async function checkPageHtml(pathname) {
  const url = `${BASE}${pathname}`;
  try {
    const { status, body } = await fetchText(url);
    if (status === 401 || status === 403) {
      record(`HTML ${pathname}`, true, `protected (status=${status}) — skipping body check`);
      return;
    }
    // Step 188 — a page we're actively asking Google to index must be
    // reachable directly at 200, not via a redirect.
    if (INDEXABLE_PATHS.includes(pathname)) {
      record(`indexable URL does not redirect ${pathname}`, status === 200, `status=${status}`);
    }
    if (!body) {
      record(`HTML ${pathname}`, false, `empty body (status=${status})`);
      return;
    }

    const canonicalMatch = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (canonicalMatch) {
      const href = canonicalMatch[1];
      const ok = href.startsWith(NON_WWW_HOST);
      record(`canonical non-www/https on ${pathname}`, ok, `href=${href}`);
      // Step 188 — a sitemap-worthy page's canonical must point at
      // ITSELF, not some other URL (that would be an accidental
      // cross-canonicalization).
      if (INDEXABLE_PATHS.includes(pathname)) {
        const selfRef = href === `${NON_WWW_HOST}${pathname}`;
        record(`self-referencing canonical on ${pathname}`, selfRef, `href=${href}`);
      }
    } else if (!NOINDEX_PATHS.includes(pathname) && !pathname.startsWith('/api/')) {
      record(`canonical present on ${pathname}`, false, 'no <link rel="canonical">');
    }

    if (INDEXABLE_PATHS.includes(pathname)) {
      const ogUrl = body.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i);
      if (ogUrl) {
        record(`og:url non-www on ${pathname}`, ogUrl[1].startsWith(NON_WWW_HOST), `og:url=${ogUrl[1]}`);
      } else {
        record(`og:url present on ${pathname}`, false, 'no og:url meta');
      }
      const ogTitle = body.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
      record(`og:title present on ${pathname}`, !!ogTitle, ogTitle ? ogTitle[1].slice(0, 80) : 'missing');
      const ogDesc = body.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
      record(`og:description present on ${pathname}`, !!ogDesc, ogDesc ? ogDesc[1].slice(0, 80) : 'missing');
      const twTitle = body.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i);
      record(`twitter:title present on ${pathname}`, !!twTitle, twTitle ? twTitle[1].slice(0, 80) : 'missing');
      const twDesc = body.match(/<meta\s+name="twitter:description"\s+content="([^"]+)"/i);
      record(`twitter:description present on ${pathname}`, !!twDesc, twDesc ? twDesc[1].slice(0, 80) : 'missing');
    }

    const wwwInHtml = body.match(/https:\/\/www\.wageronweather\.com[^"\s<]*/);
    record(
      `no www URL in HTML body for ${pathname}`,
      !wwwInHtml,
      wwwInHtml ? `found: ${wwwInHtml[0].slice(0, 80)}` : undefined,
    );

    const jsonLdBlocks = Array.from(
      body.matchAll(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
    ).map((m) => m[1]);
    let badJsonLdUrl = null;
    let jsonLdMentionsBreadcrumb = false;
    for (const block of jsonLdBlocks) {
      const wwwHit = block.match(/https:\/\/www\.wageronweather\.com[^"\s,]*/);
      if (wwwHit) {
        badJsonLdUrl = wwwHit[0];
      }
      if (/BreadcrumbList/i.test(block)) jsonLdMentionsBreadcrumb = true;
    }
    record(
      `JSON-LD blocks free of www URLs on ${pathname}`,
      !badJsonLdUrl,
      badJsonLdUrl ? `found: ${badJsonLdUrl.slice(0, 80)}` : `${jsonLdBlocks.length} blocks`,
    );
    if (HUB_PATHS.includes(pathname) || ZIP_PATHS.includes(pathname)) {
      record(
        `BreadcrumbList JSON-LD on ${pathname}`,
        jsonLdMentionsBreadcrumb,
        jsonLdMentionsBreadcrumb ? undefined : 'no BreadcrumbList block',
      );
    }

    if (HUB_PATHS.includes(pathname)) {
      const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      record(`hub H1 present on ${pathname}`, !!h1, h1 ? h1[1].replace(/\s+/g, ' ').slice(0, 96) : 'no H1');
      const metaDesc = body.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
      record(`hub meta description on ${pathname}`, !!metaDesc && metaDesc[1].length > 60, metaDesc ? `${metaDesc[1].length} chars` : 'missing');
    }

    if (ZIP_PATHS.includes(pathname)) {
      const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      record(`ZIP H1 present on ${pathname}`, !!h1 && /Weather Forecast/i.test(h1[1]), h1 ? h1[1].replace(/\s+/g, ' ').slice(0, 96) : 'no H1');
      const metaDesc = body.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
      record(`ZIP meta description on ${pathname}`, !!metaDesc && metaDesc[1].length > 60, metaDesc ? `${metaDesc[1].length} chars` : 'missing');
      record(
        `ZIP internal-link module on ${pathname}`,
        /More Local Weather Pages/i.test(body),
        /More Local Weather Pages/i.test(body) ? 'present' : 'missing',
      );
    }

    if (NOINDEX_PATHS.includes(pathname) && !pathname.startsWith('/api/')) {
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      const ok = !!robots && /noindex/i.test(robots[1]) && /nofollow/i.test(robots[1]);
      record(
        `noindex,nofollow meta on ${pathname}`,
        ok,
        robots ? robots[1] : 'no meta robots',
      );
    }

    // Step 188 — non-allowlisted ZIPs must be noindex,FOLLOW: still
    // crawlable (so Google reaches allowlisted/hub pages through their
    // links), just not indexed themselves.
    if (NOINDEX_FOLLOW_PATHS.includes(pathname)) {
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      const ok = !!robots && /noindex/i.test(robots[1]) && /follow/i.test(robots[1]) && !/nofollow/i.test(robots[1]);
      record(
        `noindex,follow meta on non-allowlisted ZIP ${pathname}`,
        ok,
        robots ? robots[1] : 'no meta robots',
      );
    }

    // Step 188 — allowlisted ZIPs and other genuinely indexable pages
    // must NOT carry any noindex.
    if (INDEXABLE_PATHS.includes(pathname)) {
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      const ok = !robots || !/noindex/i.test(robots[1]);
      record(
        `no noindex on indexable page ${pathname}`,
        ok,
        robots ? robots[1] : 'no meta robots tag (fine — omission = indexable)',
      );
    }
  } catch (err) {
    record(`HTML ${pathname}`, false, `fetch_error: ${err?.message ?? err}`);
  }
}

// ── 3. X-Robots-Tag on admin + API admin ──────────────────────────────────

async function checkAdminHeader(pathname) {
  const url = `${BASE}${pathname}`;
  try {
    const { headers } = await fetchText(url);
    const xrt = headers.get('x-robots-tag') || '';
    const ok = /noindex/i.test(xrt);
    record(`X-Robots-Tag noindex on ${pathname}`, ok, `x-robots-tag="${xrt}"`);
  } catch (err) {
    record(`X-Robots-Tag ${pathname}`, false, `fetch_error: ${err?.message ?? err}`);
  }
}

// ── 4. Sharded sitemap inspection ─────────────────────────────────────────

const FORBIDDEN_SUBSTRINGS = ['/admin/', '/api/', '/login', '/signup', '/account/', '/dashboard', '/settings', '/preview', '/internal/'];

async function checkSitemapIndexAndShards() {
  let indexBody = '';
  try {
    const { status, body } = await fetchText(SITEMAP_INDEX);
    if (status !== 200) {
      record('sitemap-index reachable', false, `status=${status}`);
      return;
    }
    record('sitemap-index reachable', true, `status=${status}`);
    indexBody = body;
  } catch (err) {
    record('sitemap-index', false, `fetch_error: ${err?.message ?? err}`);
    return;
  }

  const shardUrls = Array.from(indexBody.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  record(
    'sitemap-index contains only non-www children',
    shardUrls.every((u) => u.startsWith(NON_WWW_HOST)),
    shardUrls.find((u) => !u.startsWith(NON_WWW_HOST)) ?? `${shardUrls.length} shards`,
  );

  for (const expected of EXPECTED_TOP_LEVEL_SHARDS) {
    record(
      `sitemap-index references ${expected}`,
      shardUrls.some((u) => u.endsWith(expected)),
      shardUrls.some((u) => u.endsWith(expected)) ? undefined : 'missing from index',
    );
  }
  for (const expected of EXPECTED_STATE_ZIP_SHARDS) {
    record(
      `sitemap-index references ${expected}`,
      shardUrls.some((u) => u.endsWith(expected)),
      shardUrls.some((u) => u.endsWith(expected)) ? undefined : 'missing from index',
    );
  }

  // Inspect every shard for: status 200, only non-www URLs, no
  // forbidden URLs, and accumulate every URL for the duplicate check.
  const allUrls = new Map(); // url → first shard URL it appeared in
  let duplicateCount = 0;
  let firstDuplicate = null;

  for (const shardUrl of shardUrls) {
    try {
      const { status, body } = await fetchText(shardUrl);
      record(`shard 200 ${shardUrl}`, status === 200, `status=${status}`);
      const locs = Array.from(body.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
      record(
        `shard non-www ${shardUrl}`,
        locs.every((u) => u.startsWith(NON_WWW_HOST)),
        locs.find((u) => !u.startsWith(NON_WWW_HOST)) ?? `${locs.length} URLs`,
      );
      const forbidden = locs.find((u) => FORBIDDEN_SUBSTRINGS.some((s) => u.includes(s)));
      record(
        `shard excludes private routes ${shardUrl}`,
        !forbidden,
        forbidden ?? `${locs.length} URLs`,
      );
      for (const u of locs) {
        if (allUrls.has(u)) {
          duplicateCount += 1;
          if (!firstDuplicate) {
            firstDuplicate = { url: u, firstShard: allUrls.get(u), dupShard: shardUrl };
          }
        } else {
          allUrls.set(u, shardUrl);
        }
      }
    } catch (err) {
      record(`shard fetch ${shardUrl}`, false, `fetch_error: ${err?.message ?? err}`);
    }
  }

  record(
    'no duplicate URLs across sitemap shards',
    duplicateCount === 0,
    duplicateCount === 0
      ? `${allUrls.size} unique URLs across ${shardUrls.length} shards`
      : `first dup ${firstDuplicate?.url ?? ''} in ${firstDuplicate?.dupShard ?? ''} (originally in ${firstDuplicate?.firstShard ?? ''})`,
  );

  // Step 188 — every URL a sitemap actually advertises must itself be
  // 200, non-noindex, and self-canonical. This checks the REAL sitemap
  // contents, not just the fixed sample lists above — it's the
  // strongest version of "sitemap URL has noindex" / "canonical differs
  // from itself" / "noindex ZIP accidentally in sitemap".
  for (const [locUrl] of allUrls) {
    try {
      const { status, body } = await fetchText(locUrl);
      record(`sitemap URL 200 ${locUrl}`, status === 200, `status=${status}`);
      if (status !== 200 || !body) continue;
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      record(
        `sitemap URL not noindex ${locUrl}`,
        !robots || !/noindex/i.test(robots[1]),
        robots ? robots[1] : 'no robots meta',
      );
      const canonicalMatch = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
      record(
        `sitemap URL self-canonical ${locUrl}`,
        !!canonicalMatch && canonicalMatch[1] === locUrl,
        canonicalMatch ? `href=${canonicalMatch[1]}` : 'no canonical tag',
      );
    } catch (err) {
      record(`sitemap URL fetch ${locUrl}`, false, `fetch_error: ${err?.message ?? err}`);
    }
  }
}

// ── 5. Legacy duplicate ZIP URL format collapses to canonical ──────────

async function checkLegacyUrlRedirect() {
  // A non-exception legacy zip-first URL must 301 to the canonical
  // (zip-last) format. 90063 / Los Angeles, CA is a confirmed-real
  // record in us-zip-codes.json.
  const legacyUrl = `${BASE}/united-states-90063-los-angeles-california`;
  try {
    const { status, headers } = await fetchText(legacyUrl);
    const location = headers.get('location') || '';
    const ok = status === 301 && /\/united-states-california-los-angeles-90063$/.test(location);
    record(
      `legacy zip-first URL 301s to canonical format`,
      ok,
      `status=${status}, location=${location}`,
    );
  } catch (err) {
    record('legacy zip-first URL redirect', false, `fetch_error: ${err?.message ?? err}`);
  }

  // The Cincinnati exception must NOT redirect — it stays on the legacy
  // format because GSC already has it indexed there.
  const cincinnatiUrl = `${BASE}${CINCINNATI_LEGACY_PATH}`;
  try {
    const { status } = await fetchText(cincinnatiUrl);
    record(
      `Cincinnati exception (${CINCINNATI_LEGACY_PATH}) does NOT redirect`,
      status === 200,
      `status=${status}`,
    );
  } catch (err) {
    record('Cincinnati exception redirect check', false, `fetch_error: ${err?.message ?? err}`);
  }
}

// ── 6. Sports-hub links are real <a href>, reachable, and linked from the homepage ──

async function checkSportsHubLinks() {
  let homepageBody = '';
  try {
    const { body } = await fetchText(`${BASE}/`);
    homepageBody = body;
  } catch (err) {
    record('homepage fetch for sports-hub link check', false, `fetch_error: ${err?.message ?? err}`);
    return;
  }
  for (const path of SPORTS_HUB_PATHS) {
    const linkedFromHomepage = new RegExp(`href="${path}"`).test(homepageBody);
    record(`homepage links to ${path}`, linkedFromHomepage, linkedFromHomepage ? 'found <a href>' : 'not found in homepage HTML');
    try {
      const { status } = await fetchText(`${BASE}${path}`);
      record(`sports hub reachable ${path}`, status === 200, `status=${status}`);
    } catch (err) {
      record(`sports hub reachable ${path}`, false, `fetch_error: ${err?.message ?? err}`);
    }
  }
}

// ── 7. The four required Phase 1 cases, explicitly ───────────────────────
//
// Consolidated, unambiguous checks for exactly the cases the recovery
// architecture must get right. Overlaps with checks 1-6 above (which
// cover more URLs, more thoroughly) but this is the single place to look
// for a clean yes/no on each case.

const REPRESENTATIVE_ALLOWLISTED_ZIP = indexableLocationsData.locations.find((l) => l.zip === '45221').urlPath; // Cincinnati
const REPRESENTATIVE_NON_ALLOWLISTED_ZIP = '/united-states-california-los-angeles-90063';
// Deliberately NOT a fake-but-digit-shaped ZIP (e.g. .../99999-...): the
// app's existing (pre-Step-188, unrelated) Nominatim fallback does live
// external geocoding for any 5-digit token not in the local dataset, and
// Nominatim sometimes fuzzy-matches a nonsense number to a real place —
// confirmed live: 99999 and 88888 both resolved to something via
// Nominatim, while 00001 and 55555 correctly failed to resolve. That
// makes digit-shaped "invalid" ZIPs non-deterministic for an automated
// check. A slug with no 5-digit token at all never reaches geocoding —
// parseLocationSlug() returns null immediately — so this is deterministic.
const INVALID_ZIP_PATH = '/united-states-totally-invalid-garbage-slug';

async function fetchLocFromAllShards() {
  const { body: indexBody } = await fetchText(SITEMAP_INDEX);
  const shardUrls = Array.from(indexBody.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  const allLocs = new Set();
  for (const shardUrl of shardUrls) {
    if (!shardUrl.includes('sitemap-zips-')) continue; // only need to search ZIP shards for these checks
    const { body } = await fetchText(shardUrl);
    for (const m of body.matchAll(/<loc>([^<]+)<\/loc>/g)) allLocs.add(m[1]);
  }
  return allLocs;
}

async function checkRequiredCases() {
  let sitemapZipLocs;
  try {
    sitemapZipLocs = await fetchLocFromAllShards();
  } catch (err) {
    record('fetch sitemap ZIP shards for three-case check', false, `fetch_error: ${err?.message ?? err}`);
    sitemapZipLocs = new Set();
  }

  // Case 1: allowlisted valid ZIP → 200, indexable, self-canonical, in sitemap.
  {
    const path = REPRESENTATIVE_ALLOWLISTED_ZIP;
    const url = `${BASE}${path}`;
    try {
      const { status, body } = await fetchText(url);
      record('[CASE 1] allowlisted ZIP → 200', status === 200, `status=${status}`);
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      record('[CASE 1] allowlisted ZIP → indexable (no noindex)', !robots || !/noindex/i.test(robots[1]), robots ? robots[1] : 'no robots meta');
      const canonical = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
      record('[CASE 1] allowlisted ZIP → self-canonical', !!canonical && canonical[1] === url, canonical ? canonical[1] : 'no canonical');
      record('[CASE 1] allowlisted ZIP → in sitemap', sitemapZipLocs.has(url), sitemapZipLocs.has(url) ? 'found' : 'NOT found in any ZIP shard');
    } catch (err) {
      record('[CASE 1] allowlisted ZIP', false, `fetch_error: ${err?.message ?? err}`);
    }
  }

  // Case 2: valid non-allowlisted ZIP → 200, noindex,follow, self-canonical, NOT in sitemap.
  {
    const path = REPRESENTATIVE_NON_ALLOWLISTED_ZIP;
    const url = `${BASE}${path}`;
    try {
      const { status, body } = await fetchText(url);
      record('[CASE 2] non-allowlisted ZIP → 200', status === 200, `status=${status}`);
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      const robotsOk = !!robots && /noindex/i.test(robots[1]) && /follow/i.test(robots[1]) && !/nofollow/i.test(robots[1]);
      record('[CASE 2] non-allowlisted ZIP → noindex,follow', robotsOk, robots ? robots[1] : 'no robots meta');
      const canonical = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
      record('[CASE 2] non-allowlisted ZIP → self-canonical', !!canonical && canonical[1] === url, canonical ? canonical[1] : 'no canonical');
      record('[CASE 2] non-allowlisted ZIP → NOT in sitemap', !sitemapZipLocs.has(url), sitemapZipLocs.has(url) ? 'unexpectedly found in a ZIP shard' : 'absent, correct');
    } catch (err) {
      record('[CASE 2] non-allowlisted ZIP', false, `fetch_error: ${err?.message ?? err}`);
    }
  }

  // Case 3: ZIP-format value NOT in the local dataset → 404, and — since
  // Nominatim is no longer consulted at all for US ZIPs — fast (no
  // external round-trip). A live Nominatim call from this network
  // typically adds several hundred ms; local dataset lookups resolve in
  // low single-digit ms. This is a proxy for "no external geocoding
  // request happened", not absolute proof (see the unit-test fetch-spy
  // in tests/geocode-authoritative.test.ts for the definitive check).
  {
    const path = '/united-states-99999-nowhere-nowhere'; // 99999 is not in us-zip-codes.json
    const url = `${BASE}${path}`;
    try {
      const start = Date.now();
      const { status } = await fetchText(url);
      const elapsedMs = Date.now() - start;
      record('[CASE 3] unknown ZIP-format value → true 404', status === 404, `status=${status}`);
      record('[CASE 3] unknown ZIP-format value → NOT in sitemap', !sitemapZipLocs.has(url), sitemapZipLocs.has(url) ? 'unexpectedly found in a ZIP shard' : 'absent, correct');
      record('[CASE 3] unknown ZIP-format value → fast response (no external geocode round-trip)', elapsedMs < 300, `${elapsedMs}ms`);
    } catch (err) {
      record('[CASE 3] unknown ZIP-format value', false, `fetch_error: ${err?.message ?? err}`);
    }
  }

  // Case 4: garbage non-ZIP slug (no 5-digit token at all) → true 404.
  {
    const path = INVALID_ZIP_PATH;
    const url = `${BASE}${path}`;
    try {
      const { status } = await fetchText(url);
      record('[CASE 4] garbage non-ZIP slug → true 404 (not a 302 redirect)', status === 404, `status=${status}`);
      record('[CASE 4] garbage non-ZIP slug → NOT in sitemap', !sitemapZipLocs.has(url), sitemapZipLocs.has(url) ? 'unexpectedly found in a ZIP shard' : 'absent, correct');
    } catch (err) {
      record('[CASE 4] garbage non-ZIP slug', false, `fetch_error: ${err?.message ?? err}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!QUIET) console.log(`Verifying SEO routing against ${BASE}`);
  for (const path of ALL_PATHS) {
    await checkWwwRedirect(path);
    await checkPageHtml(path);
    if (path.startsWith('/admin') || path.startsWith('/api/')) {
      await checkAdminHeader(path);
    }
  }
  await checkSitemapIndexAndShards();
  await checkLegacyUrlRedirect();
  await checkSportsHubLinks();
  await checkRequiredCases();

  const failures = results.filter((r) => !r.ok);
  if (!QUIET) {
    console.log('');
    console.log(`Summary: ${results.length - failures.length}/${results.length} checks passed`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
