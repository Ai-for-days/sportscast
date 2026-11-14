// SEO S2 (Professor ruling WOW-015): the sitemap index must never stamp
// <lastmod> with the request time. Google trusts lastmod only when it is
// verifiably accurate; "changed just now" on every fetch is not. The set of
// <loc> URLs must not change with this fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../src/pages/sitemap-index.xml';
import {
  listShardManifest,
  renderSitemapIndex,
  renderUrlSet,
  buildPagesShard,
  buildStatesShard,
  buildCitiesShard,
} from '../src/lib/seo/sitemap-shards';

const locs = (xml: string) => xml.match(/<loc>[^<]*<\/loc>/g) ?? [];

async function bodyAt(isoNow: string): Promise<string> {
  const RealDate = Date;
  const fixed = new RealDate(isoNow).getTime();
  class FakeDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      // @ts-expect-error spread into Date overloads
      else super(...args);
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FakeDate as DateConstructor;
  try {
    const res = await (GET as (ctx: unknown) => Promise<Response>)({ params: {} });
    assert.equal(res.status, 200);
    return await res.text();
  } finally {
    globalThis.Date = RealDate;
  }
}

test('sitemap index body does not depend on the request time', async () => {
  const a = await bodyAt('2026-01-01T00:00:00.000Z');
  const b = await bodyAt('2026-11-14T16:28:31.402Z');
  assert.equal(a, b);
  assert.ok(!a.includes('2026-11-14T16:28:31'), 'request time leaked into the sitemap index');
});

test('sitemap index carries no <lastmod> (no stored content-change date exists)', async () => {
  const body = await bodyAt('2026-11-14T12:00:00.000Z');
  assert.ok(!/<lastmod>/.test(body), 'index must omit <lastmod>');
});

test('sitemap index <loc> set is exactly the shard manifest, unchanged by the fix', async () => {
  const body = await bodyAt('2026-11-14T12:00:00.000Z');
  const manifest = listShardManifest();
  assert.deepEqual(locs(body), manifest.map((m) => `<loc>${m.url}</loc>`));
  // Same locs as the pre-fix renderer, which always took a lastmod argument.
  assert.deepEqual(locs(body), locs(renderSitemapIndex(manifest, '2000-01-01T00:00:00.000Z')));
});

test('renderSitemapIndex still emits a lastmod when a real date is passed', () => {
  const xml = renderSitemapIndex(listShardManifest(), '2026-11-01');
  assert.ok(xml.includes('<lastmod>2026-11-01</lastmod>'));
});

test('child URL sets emit no <lastmod>', () => {
  for (const entries of [buildPagesShard(), buildStatesShard(), buildCitiesShard()]) {
    assert.ok(!/<lastmod>/.test(renderUrlSet(entries)));
  }
});
