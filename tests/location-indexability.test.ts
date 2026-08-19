import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldIndexLocationPage, listIndexableZips, listIndexableLocations } from '../src/lib/seo/location-indexability';
import { buildZipShardForState, listShardManifest } from '../src/lib/seo/sitemap-shards';
import { isTierOneZip } from '../src/lib/seo/zip-priority';

// Step 188 — pins the core Phase 1 recovery-architecture invariants so a
// future change can't silently widen (or accidentally shrink) the
// indexable footprint without a test failing.

test('allowlisted locations are indexable', () => {
  assert.equal(shouldIndexLocationPage({ zip: '45221', city: 'Cincinnati', state: 'OH' }), true);
  assert.equal(shouldIndexLocationPage({ zip: '10001', city: 'New York', state: 'NY' }), true);
});

test('an arbitrary long-tail ZIP is NOT indexable by default', () => {
  // A ZIP that is not on the allowlist and not one of the 5 hand-authored
  // priority ZIPs. Picked arbitrarily from us-zip-codes.json.
  assert.equal(shouldIndexLocationPage({ zip: '35201', city: 'Birmingham', state: 'AL' }), false);
});

test('empty/missing zip is never indexable (covers the coordinate-fallback render path)', () => {
  assert.equal(shouldIndexLocationPage({ zip: '', city: 'Somewhere', state: 'TX' }), false);
  assert.equal(shouldIndexLocationPage({ zip: undefined as unknown as string }), false);
});

test('the allowlist is deliberately small — this must fail loudly if it ever grows without review', () => {
  const zips = listIndexableZips();
  assert.ok(zips.size <= 25, `expected a small, deliberate allowlist; found ${zips.size} entries — bulk-adding ZIPs was explicitly ruled out`);
  assert.ok(zips.has('45221'), 'Cincinnati 45221 must stay on the allowlist — GSC-confirmed indexed');
});

test('every allowlist entry has a non-empty reason (no silent additions)', () => {
  for (const loc of listIndexableLocations()) {
    assert.ok(loc.reason && loc.reason.length > 10, `${loc.zip} is missing a documented reason`);
  }
});

test('allowlisted ZIPs are promoted to Tier 1 for internal linking', () => {
  assert.equal(isTierOneZip({ z: '45221', c: 'Cincinnati', s: 'OH' }), true);
});

test('sitemap ZIP shards only ever contain indexable URLs', () => {
  for (const stateAbbr of ['OH', 'NY', 'TX', 'MN', 'OK', 'CA', 'AL']) {
    const entries = buildZipShardForState(stateAbbr);
    for (const e of entries) {
      assert.ok(e.loc.startsWith('https://wageronweather.com/'), `non-canonical host in shard: ${e.loc}`);
      assert.ok(!e.loc.includes('//www.'), `www host leaked into shard: ${e.loc}`);
    }
  }
  // Most states now have zero allowlisted ZIPs, by design.
  assert.equal(buildZipShardForState('AL').length, 0);
});

test('Cincinnati sitemap entry uses the legacy indexed URL, not a freshly-derived duplicate', () => {
  // Regression: buildZipShardForState() used to always construct the
  // state-first URL, which would have submitted a SECOND, un-redirected
  // URL for Cincinnati to Google — the opposite of protecting its one
  // already-indexed URL.
  const oh = buildZipShardForState('OH');
  assert.equal(oh.length, 1);
  assert.equal(oh[0].loc, 'https://wageronweather.com/united-states-45221-cincinnati-ohio');
});

test('sitemap index never lists a per-state ZIP shard that would 404', () => {
  const manifest = listShardManifest();
  for (const m of manifest) {
    if (!m.slug.startsWith('zips-')) continue;
    const stateAbbr = m.slug.replace('zips-', '').toUpperCase();
    assert.ok(buildZipShardForState(stateAbbr).length > 0, `${m.url} is listed in the index but would 404 (empty shard)`);
  }
});

// ── The three required Phase 1 cases ────────────────────────────────────
// HTTP status / robots-meta / self-canonical for these three are verified
// live by `scripts/verify-seo-routing.mjs` (`npm run seo:audit`) — no
// existing harness in this repo renders an Astro SSR route in a unit
// test. These pin what IS pure-function-testable: the indexability
// decision and sitemap membership driving those HTTP-level outcomes.

test('[CASE 1] allowlisted valid ZIP (Cincinnati 45221) is indexable and in its sitemap shard', () => {
  assert.equal(shouldIndexLocationPage({ zip: '45221', city: 'Cincinnati', state: 'OH' }), true);
  const oh = buildZipShardForState('OH');
  assert.ok(oh.some((e) => e.loc === 'https://wageronweather.com/united-states-45221-cincinnati-ohio'));
});

test('[CASE 2] valid non-allowlisted ZIP (LA 90063) is not indexable and absent from its sitemap shard', () => {
  assert.equal(shouldIndexLocationPage({ zip: '90063', city: 'Los Angeles', state: 'CA' }), false);
  const ca = buildZipShardForState('CA');
  assert.equal(ca.length, 0, 'CA has zero allowlisted ZIPs — 90063 must not appear');
});

test('[CASE 3] invalid/nonexistent ZIP (99999) is not indexable and cannot appear in any sitemap shard', () => {
  // 99999 is not a real ZIP in us-zip-codes.json, so it can never be
  // classified indexable regardless of state/city text supplied.
  assert.equal(shouldIndexLocationPage({ zip: '99999', city: 'Nowhere', state: 'ZZ' }), false);
  for (const stateAbbr of ['OH', 'NY', 'TX', 'MN', 'OK', 'CA', 'AL', 'ZZ']) {
    const entries = buildZipShardForState(stateAbbr);
    assert.ok(!entries.some((e) => e.loc.includes('99999')), `99999 must not appear in the ${stateAbbr} shard`);
  }
});
