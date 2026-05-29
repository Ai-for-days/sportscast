#!/usr/bin/env node
// ── Step 174 / 175 / 176: SEO routing verification script ───────────────
//
// Step 176 broadens coverage to the sharded sitemap-index, every
// individual shard, and a representative set of Tier-1/2/3 ZIPs
// across multiple states.
//
// Run from a deploy preview or production URL — local dev does NOT
// exercise the Vercel host-based 301 redirect.
//
// Usage:
//   node scripts/verify-seo-routing.mjs                       # defaults to https://wageronweather.com
//   node scripts/verify-seo-routing.mjs --base https://wageronweather.com
//   node scripts/verify-seo-routing.mjs --base https://wageronweather.com --quiet
//
// Exit code 0 on all-pass, 1 on any failure.

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

const PRIORITY_ZIP_PATHS = [
  '/united-states-new-york-new-york-10001',
  '/united-states-minnesota-saint-paul-55101',
  '/united-states-texas-houston-77205',
  '/united-states-texas-dallas-75201',
  '/united-states-oklahoma-oklahoma-city-73101',
];

// ≥25 Tier-2/3 sample ZIPs across diverse states. These are real ZIPs
// from the dataset.
const NON_PRIORITY_ZIP_PATHS = [
  '/united-states-california-los-angeles-90001',
  '/united-states-illinois-chicago-60601',
  '/united-states-florida-miami-33101',
  '/united-states-washington-seattle-98101',
  '/united-states-massachusetts-boston-02101',
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

const NOINDEX_PATHS = [
  '/admin',
  '/api/admin/system/weathernext-probe',
  '/login',
  '/signup',
  '/account',
  '/dashboard',
];

const INDEXABLE_PATHS = [
  ...HOMEPAGE_PATHS,
  ...STATE_HUB_PATHS,
  ...CITY_HUB_PATHS,
  ...PRIORITY_ZIP_PATHS,
  ...NON_PRIORITY_ZIP_PATHS,
];

const ZIP_PATHS = [...PRIORITY_ZIP_PATHS, ...NON_PRIORITY_ZIP_PATHS];
const HUB_PATHS = [...STATE_HUB_PATHS, ...CITY_HUB_PATHS];
const ALL_PATHS = [...INDEXABLE_PATHS, ...NOINDEX_PATHS];

const SITEMAP_INDEX = `${BASE}/sitemap-index.xml`;

// Expected top-level shard slugs that the index must reference.
const EXPECTED_TOP_LEVEL_SHARDS = [
  '/sitemap-pages.xml',
  '/sitemap-states.xml',
  '/sitemap-cities.xml',
];
// Expected per-state ZIP shard slugs (sample — we don't enumerate all 51).
const EXPECTED_STATE_ZIP_SHARDS = [
  '/sitemap-zips-tx.xml',
  '/sitemap-zips-ca.xml',
  '/sitemap-zips-ny.xml',
  '/sitemap-zips-fl.xml',
];

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
    if (!body) {
      record(`HTML ${pathname}`, false, `empty body (status=${status})`);
      return;
    }

    const canonicalMatch = body.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (canonicalMatch) {
      const href = canonicalMatch[1];
      const ok = href.startsWith(NON_WWW_HOST);
      record(`canonical non-www on ${pathname}`, ok, `href=${href}`);
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
      const ok = !!robots && /noindex/i.test(robots[1]);
      record(
        `noindex meta on ${pathname}`,
        ok,
        robots ? robots[1] : 'no meta robots',
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
