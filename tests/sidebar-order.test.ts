import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sortByStart, sportForPath } from '../src/lib/sidebar-order';

describe('betting sidebar order and default sport (2026-11-17)', () => {
  it('puts the soonest game first and games without a time last', () => {
    const g = [{ id: 'c', startTime: 300 }, { id: 'x', startTime: null }, { id: 'a', startTime: 100 }, { id: 'b', startTime: 200 }];
    assert.deepEqual(sortByStart(g).map((x) => x.id), ['a', 'b', 'c', 'x']);
    assert.equal(g[0].id, 'c'); // input not mutated
  });
  it('opens on the sport of the page', () => {
    assert.equal(sportForPath('/weatherboard/college-football'), 'football/college-football');
    assert.equal(sportForPath('/weatherboard/extended/college-football'), 'football/college-football');
    assert.equal(sportForPath('/weatherboard/mlb'), 'baseball/mlb');
    assert.equal(sportForPath('/weatherboard/extended/mls'), 'soccer/north-america/united-states/mls');
    assert.equal(sportForPath('/weatherboard/nfl'), 'football/nfl');
    assert.equal(sportForPath('/weatherboard'), 'football/nfl');
  });
  it('the games list uses the sorted order and has no inner scroll box', () => {
    const s = readFileSync('src/components/betting/GamesList.tsx', 'utf8');
    assert.ok(s.includes('sortByStart(games).map'));
    assert.ok(!s.includes('max-h-96'));
  });
  it('sidebar markets are readable in light mode (no dark panel without a dark: prefix)', () => {
    for (const f of ['src/components/betting/GamesList.tsx', 'src/components/betting/MarketSelector.tsx']) {
      const s = readFileSync(f, 'utf8');
      assert.doesNotMatch(s, /(^|[\s"'`])bg-surface-dark(-alt)?(?=[\s"'`])/m);
      assert.doesNotMatch(s, /(^|[\s"'`])text-text-dark(-muted)?(?=[\s"'`])/m);
    }
  });
  it('rows jumped to from /weatherboard clear the fixed header', () => {
    for (const f of ['src/components/schedule/WeatherboardExtendedTable.astro', 'src/components/schedule/WeatherboardTable.astro']) {
      assert.ok(readFileSync(f, 'utf8').includes('id={`game-${g.id}`} class="scroll-mt-24'));
    }
  });
});
