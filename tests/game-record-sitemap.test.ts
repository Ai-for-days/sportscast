// WOW-032 S2: sitemap-games.xml (NFL and CFB game pages, lastmod = frozenAt only).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGamesShard, listShardManifest, renderUrlSet, renderSitemapIndex, assignSitemapShard } from '../src/lib/seo/sitemap-shards';
import { GAME_SITEMAP_LEAGUES } from '../src/lib/game-record';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('sitemap-games.xml', () => {
  it('NFL and CFB pages only, lastmod from the stored frozenAt', () => {
    const shard = buildGamesShard([
      { path: '/games/nfl/2026-11-16/buffalo-at-kansas-city', lastmod: '2026-11-17T12:00:00.000Z' },
      { path: '/games/college-football/2026-11-15/georgia-at-florida-g2', lastmod: '2026-11-16T12:00:00.000Z' },
      { path: '/games/mlb/2026-09-01/boston-at-new-york-yankees', lastmod: '2026-09-02T12:00:00.000Z' },
      { path: '/games/mls/2026-09-01/a-at-b', lastmod: '2026-09-02T12:00:00.000Z' },
      { path: '/games/nfl/2026-11-16/no-date-at-all', lastmod: '' },
    ]);
    assert.deepEqual(shard, [
      { loc: 'https://wageronweather.com/games/college-football/2026-11-15/georgia-at-florida-g2', lastmod: '2026-11-16T12:00:00.000Z' },
      { loc: 'https://wageronweather.com/games/nfl/2026-11-16/buffalo-at-kansas-city', lastmod: '2026-11-17T12:00:00.000Z' },
    ]);
    const xml = renderUrlSet(shard);
    assert.equal((xml.match(/<lastmod>/g) ?? []).length, 2);
    assert.deepEqual([...GAME_SITEMAP_LEAGUES], ['nfl', 'ncaa-football']);
  });
  it('an empty set is a valid, empty urlset', () => {
    assert.match(renderUrlSet(buildGamesShard([])), /<urlset[^>]*>\n\n<\/urlset>/);
  });
  it('is listed in the sitemap index, which still carries no lastmod of its own', () => {
    const m = listShardManifest();
    assert.ok(m.some((x) => x.url === 'https://wageronweather.com/sitemap-games.xml'));
    assert.doesNotMatch(renderSitemapIndex(m), /<lastmod>/);
  });
  it('game paths classify to the games shard', () => {
    assert.equal(assignSitemapShard('/games/nfl/2026-11-16/buffalo-at-kansas-city'), 'https://wageronweather.com/sitemap-games.xml');
    assert.equal(assignSitemapShard('/games/mlb/2026-09-01/boston-at-new-york-yankees'), undefined);
  });
  it('the route reads the stored set and never stamps a request-time date', () => {
    const src = read('src/pages/sitemap-games.xml.ts');
    assert.match(src, /getSitemapGameEntries\(GAME_SITEMAP_LEAGUES\)/);
    assert.doesNotMatch(src, /new Date\(\)|Date\.now\(\)/);
  });
});
