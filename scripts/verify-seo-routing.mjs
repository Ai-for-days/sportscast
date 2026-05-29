#!/usr/bin/env node
// ── Step 174: SEO routing verification script ───────────────────────────
//
// Lightweight end-to-end checker that hits the live production site
// (or a local preview) and asserts:
//
//   - www URLs 301-redirect to the exact non-www equivalent.
//   - Canonical tag on every rendered page is non-www.
//   - Sitemap-index + child sitemaps contain only non-www URLs.
//   - Sitemap excludes `/admin/` and `/api/` entries.
//   - Generated metadata + JSON-LD contains no `www.wageronweather.com`.
//   - The 6 spec test routes return the expected indexation posture
//     (homepage / state hub / city hub / priority ZIP indexable; admin
//     route + admin API noindex).
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

const PAGE_PATHS = [
  '/',
  '/weather/texas',
  '/weather/texas/dallas',
  '/united-states-texas-dallas-75201',
  '/admin',
  '/api/admin/system/weathernext-probe',
];

const SITEMAP_INDEX = `${BASE}/sitemap-index.xml`;

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  if (QUIET) return;
  const tag = ok ? '[32m✓[0m' : '[31m✗[0m';
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
  if (pathname === '/admin' || pathname.startsWith('/api/')) {
    // Admin + API URLs are noindex but the host-based redirect still
    // applies. We still want the 301 to fire.
  }
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

// ── 2. canonical tag + no www in HTML metadata + JSON-LD ──────────────────

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
    } else if (pathname !== '/admin' && !pathname.startsWith('/api/')) {
      record(`canonical present on ${pathname}`, false, 'no <link rel="canonical">');
    }
    const wwwInHtml = body.match(/https:\/\/www\.wageronweather\.com[^"\s<]*/);
    record(
      `no www URL in HTML body for ${pathname}`,
      !wwwInHtml,
      wwwInHtml ? `found: ${wwwInHtml[0].slice(0, 80)}` : undefined,
    );
    // Spec test 2: admin pages must emit noindex.
    if (pathname.startsWith('/admin')) {
      const robots = body.match(/<meta\s+name="robots"\s+content="([^"]+)"/i);
      const ok = !!robots && /noindex/i.test(robots[1]);
      record(
        `admin page emits meta noindex on ${pathname}`,
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

    // Walk a couple of child sitemaps (cap to avoid hammering the host).
    const sample = childUrls.slice(0, 2);
    for (const childUrl of sample) {
      const { body: childBody } = await fetchText(childUrl);
      const locs = Array.from(childBody.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
      record(
        `child sitemap non-www (${childUrl.split('/').pop()})`,
        locs.every((u) => u.startsWith(NON_WWW_HOST)),
      );
      const admin = locs.find((u) => /\/admin\//.test(u));
      const apiAdmin = locs.find((u) => /\/api\//.test(u));
      record(`child sitemap excludes /admin/`, !admin, admin ?? `${locs.length} entries`);
      record(`child sitemap excludes /api/`, !apiAdmin, apiAdmin ?? `${locs.length} entries`);
    }
  } catch (err) {
    record('sitemap-index', false, `fetch_error: ${err?.message ?? err}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!QUIET) console.log(`Verifying SEO routing against ${BASE}`);
  for (const path of PAGE_PATHS) {
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
