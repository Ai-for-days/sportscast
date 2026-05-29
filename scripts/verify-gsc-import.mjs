#!/usr/bin/env node
// ── Step 177: GSC import verification script ────────────────────────────
//
// Smoke-tests the manual GSC reconciliation pipeline by POSTing two
// fixture CSV exports at the admin endpoint and asserting on the
// returned reconciliation report. Exits 0 on all-pass, 1 on failure.
//
// **Requires a running server with admin auth.** Either:
//
//   1. Local dev server (`npm run dev`), then paste your admin
//      session cookie.
//   2. Deployed preview / production URL with a valid admin cookie.
//
// Usage:
//   # local dev (default base)
//   node scripts/verify-gsc-import.mjs --cookie 'wow_admin_session=abc...'
//
//   # custom base
//   node scripts/verify-gsc-import.mjs \
//     --base https://wageronweather.com \
//     --cookie 'wow_admin_session=abc...'
//
//   # quiet
//   node scripts/verify-gsc-import.mjs --cookie 'wow_admin_session=abc...' --quiet
//
// The script never touches GSC. Fixtures are inline.

const ARGS = process.argv.slice(2);
let BASE = 'http://localhost:4321';
let COOKIE = '';
let QUIET = false;
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] === '--base' && ARGS[i + 1]) { BASE = ARGS[i + 1].replace(/\/+$/, ''); i += 1; }
  else if (ARGS[i] === '--cookie' && ARGS[i + 1]) { COOKIE = ARGS[i + 1]; i += 1; }
  else if (ARGS[i] === '--quiet') { QUIET = true; }
}
if (!COOKIE) {
  console.error('error: --cookie <admin session cookie value> required.');
  console.error('       paste the wow_admin_session cookie from a logged-in admin browser tab.');
  process.exit(2);
}

const ENDPOINT = `${BASE}/api/admin/system/seo-gsc-import`;
const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  if (QUIET) return;
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${label}${detail ? `  · ${detail}` : ''}`);
}

// ── Inline fixtures ──────────────────────────────────────────────────

const INDEXING_CSV = [
  'Page,Status,Reason',
  'https://wageronweather.com/,Submitted and indexed,',
  'https://www.wageronweather.com/weather/texas,Submitted and indexed,',
  'https://wageronweather.com/weather/texas/dallas,Submitted and indexed,',
  'https://wageronweather.com/united-states-texas-dallas-75201,Submitted and indexed,',
  '"https://wageronweather.com/united-states-california-los-angeles-90001","Crawled - currently not indexed","Quality"',
  'https://wageronweather.com/admin,"Excluded by ""noindex"" tag","Noindex"',
  'https://wageronweather.com/united-states-wyoming-cheyenne-82001,Discovered - currently not indexed,Crawl',
  ',,,',
].join('\n');

const PERFORMANCE_CSV = [
  'Top pages,Clicks,Impressions,CTR,Position',
  'https://wageronweather.com/,12,640,1.88%,4.2',
  'https://wageronweather.com/united-states-texas-dallas-75201,3,180,1.67%,7.5',
  'https://wageronweather.com/united-states-california-los-angeles-90001,0,42,0%,12.4',
].join('\n');

async function main() {
  if (!QUIET) console.log(`POST ${ENDPOINT}`);
  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: COOKIE,
      },
      body: JSON.stringify({ indexingCsv: INDEXING_CSV, performanceCsv: PERFORMANCE_CSV }),
    });
  } catch (err) {
    console.error(`request failed: ${err?.message ?? err}`);
    process.exit(1);
  }
  let body;
  try { body = await r.json(); } catch { body = null; }

  check(`endpoint returns 200`, r.status === 200, `status=${r.status}`);
  if (!body || !body.ok) {
    check('endpoint returns ok:true', false, JSON.stringify(body).slice(0, 200));
    summarize();
    process.exit(1);
  }
  const rep = body.report;
  check('totals.indexingRowsParsed >= 7', rep.totals.indexingRowsParsed >= 7, `got ${rep.totals.indexingRowsParsed}`);
  check('totals.performanceRowsParsed === 3', rep.totals.performanceRowsParsed === 3, `got ${rep.totals.performanceRowsParsed}`);
  check('totals.indexed > 0', rep.totals.indexed > 0);
  check('totals.notIndexed > 0', rep.totals.notIndexed > 0);
  check('totals.impressions > 0', rep.totals.impressions > 0);

  const dallas = rep.rows.find((r) => r.canonicalUrl.endsWith('/united-states-texas-dallas-75201'));
  check('Dallas 75201 reconciled', !!dallas);
  check('Dallas 75201 → Tier 1', dallas?.zipPriorityTier === 1, `tier=${dallas?.zipPriorityTier}`);
  check('Dallas 75201 → state TX', dallas?.state === 'TX');
  check('Dallas 75201 → shard sitemap-zips-tx.xml', dallas?.sitemapShard?.endsWith('/sitemap-zips-tx.xml') === true, dallas?.sitemapShard);

  const stateHub = rep.rows.find((r) => r.pathname === '/weather/texas');
  check('state hub www→non-www normalized', stateHub?.canonicalUrl === 'https://wageronweather.com/weather/texas');
  check('state hub → sitemap-states.xml', stateHub?.sitemapShard?.endsWith('/sitemap-states.xml') === true);

  const cityHub = rep.rows.find((r) => r.pathname === '/weather/texas/dallas');
  check('city hub → sitemap-cities.xml', cityHub?.sitemapShard?.endsWith('/sitemap-cities.xml') === true);

  const admin = rep.rows.find((r) => r.pathname === '/admin');
  check('admin row routeType=noindex_admin', admin?.routeType === 'noindex_admin');
  check('admin row recommendation=noindex_expected', admin?.recommendation === 'noindex_expected');
  check('admin row sitemapShard absent', admin?.sitemapShard === undefined || admin?.sitemapShard === null);

  check('canonicalIssues.wwwUrlsSeen >= 1', rep.canonicalIssues.wwwUrlsSeen >= 1, `got ${rep.canonicalIssues.wwwUrlsSeen}`);

  const wyoming = rep.rows.find((r) => r.canonicalUrl.endsWith('/united-states-wyoming-cheyenne-82001'));
  check('wyoming row mapped to crawl_budget_or_priority', wyoming?.notIndexedReason === 'crawl_budget_or_priority');

  const tier1Queue = rep.queues.find((q) => q.id === 'tier1_not_indexed');
  check('queue tier1_not_indexed exists', !!tier1Queue);

  const noindexQueue = rep.queues.find((q) => q.id === 'noindex_expected');
  const adminInQueue = noindexQueue?.items?.some((i) => i.pathname === '/admin');
  check('queue noindex_expected fires on /admin', adminInQueue === true);

  const promoteQueue = rep.queues.find((q) => q.id === 'promote_candidates');
  check('queue promote_candidates exists', !!promoteQueue);

  // Malformed input round trip.
  let r2;
  try {
    r2 = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: COOKIE },
      body: JSON.stringify({ indexingCsv: 'this is not a csv\njust some text', performanceCsv: '' }),
    });
  } catch (err) {
    check('malformed CSV: endpoint did not crash', false, err?.message);
    summarize();
    process.exit(1);
  }
  const body2 = await r2.json().catch(() => null);
  check('malformed CSV: endpoint returned 200', r2.status === 200);
  check('malformed CSV: report.totals.reconciledUrls === 0', body2?.report?.totals?.reconciledUrls === 0);

  summarize();
  const failures = results.filter((r) => !r.ok);
  process.exit(failures.length > 0 ? 1 : 0);
}

function summarize() {
  if (QUIET) return;
  const failures = results.filter((r) => !r.ok);
  console.log('');
  console.log(`Summary: ${results.length - failures.length}/${results.length} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
