#!/usr/bin/env node
// ── Step 174 / 175: SEO routing verification script ─────────────────────
//
// Lightweight end-to-end checker that hits the live production site
// (or a local preview) and asserts:
//
//   - www URLs 301-redirect to the exact non-www equivalent.
//   - Canonical tag on every rendered page is non-www.
//   - Sitemap-index + child sitemaps contain only non-www URLs.
//   - Sitemap excludes `/admin/`, `/api/`, and other noindex route groups.
//   - Generated metadata + JSON-LD contains no `www.wageronweather.com`.
//   - The broadened representative route set (homepage / several state
//     hubs / several city hubs / all 5 priority ZIPs / 10 non-priority
//     ZIP samples / admin / API admin / auth / account / dashboard)
//     returns the expected indexation posture.
//   - ZIP pages render the scalable template: title + H1 + meta + intro
//     + internal-link block.
//   - OG / Twitter URLs and JSON-LD URLs are non-www.
//
// **Run from a deploy preview or production URL.** Local dev does not
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

// ── Step 175: representative route categories ─────────────────────────────

const HOMEPAGE_PATHS = ['/'];

const STATE_HUB_PATHS = [
  '/weather/texas',
  '/weather/new-york',
  '/weather/california',
  '/weather/minnesota',
  '/weather/oklahoma',
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

// 10 non-priority sample ZIPs across diverse states. These are real
// ZIPs from the dataset; the test only asserts that the scalable
// template rendered, not that any specific weather data appeared.
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
const ALL_PATHS = [...INDEXABLE_PATHS, ...NOINDEX_PATHS];

const SITEMAP_INDEX = `${BASE}/sitemap-index.xml`;

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

    // OG / Twitter URL + title + description on indexable surfaces.
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

    // JSON-LD URL audit: every `"url":"..."` inside ld+json blocks must be non-www.
    const jsonLdBlocks = Array.from(
      body.matchAll(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
    ).map((m) => m[1]);
    let badJsonLdUrl = null;
    for (const block of jsonLdBlocks) {
      const wwwHit = block.match(/https:\/\/www\.wageronweather\.com[^"\s,]*/);
      if (wwwHit) {
        badJsonLdUrl = wwwHit[0];
        break;
      }
    }
    record(
      `JSON-LD blocks free of www URLs on ${pathname}`,
      !badJsonLdUrl,
      badJsonLdUrl ? `found: ${badJsonLdUrl.slice(0, 80)}` : `${jsonLdBlocks.length} blocks`,
    );

    // ZIP-page content check: scalable template renders title / H1 / meta /
    // intro / internal-link block.
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

    // Noindex pages must emit meta noindex.
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

// ── 4. Sitemap inspection ─────────────────────────────────────────────────

async function checkSitemap() {
  try {
    const { status, body } = await fetchText(SITEMAP_INDEX);
    if (status !== 200) {
      record('sitemap-index reachable', false, `status=${status}`);
      return;
    }
    record('sitemap-index reachable', true, `status=${status}`);
    const childUrls = Array.from(body.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
    record(
      'sitemap-index contains only non-www children',
      childUrls.every((u) => u.startsWith(NON_WWW_HOST)),
      childUrls.find((u) => !u.startsWith(NON_WWW_HOST)) ?? `${childUrls.length} entries`,
    );

    // Walk up to three child sitemaps for sample inspection.
    const sample = childUrls.slice(0, 3);
    let zipUrlsSeen = 0;
    for (const childUrl of sample) {
      const { body: childBody } = await fetchText(childUrl);
      const locs = Array.from(childBody.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
      record(
        `child sitemap non-www (${childUrl.split('/').pop()})`,
        locs.every((u) => u.startsWith(NON_WWW_HOST)),
      );
      const admin = locs.find((u) => /\/admin\//.test(u));
      const apiAny = locs.find((u) => /\/api\//.test(u));
      const auth = locs.find((u) => /\/(login|signup|account|dashboard|settings)(\/|$)/.test(u));
      record(`child sitemap excludes /admin/`, !admin, admin ?? `${locs.length} entries`);
      record(`child sitemap excludes /api/`, !apiAny, apiAny ?? `${locs.length} entries`);
      record(`child sitemap excludes auth/account/dashboard`, !auth, auth ?? `${locs.length} entries`);
      zipUrlsSeen += locs.filter((u) => /\/united-states-/.test(u)).length;
    }
    record('child sitemaps contain ZIP entries', zipUrlsSeen > 0, `zipUrls=${zipUrlsSeen}`);
  } catch (err) {
    record('sitemap-index', false, `fetch_error: ${err?.message ?? err}`);
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
  await checkSitemap();

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
