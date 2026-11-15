// 2026-11-15 DBD: "on /weatherboards the side bar covers the content and also
// isn't showing all of the sports in the dropdown". No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIDEBAR_SPORTS } from '../src/lib/sportsbook-sports';

test('the sport dropdown renders the shared list directly (no fetch, no 4-sport fallback)', () => {
  const s = readFileSync('src/components/betting/SportSelector.tsx', 'utf8');
  assert.ok(s.includes('SIDEBAR_SPORTS.map('));
  assert.ok(!s.includes('fetch('), 'no network call');
  assert.ok(SIDEBAR_SPORTS.length >= 20, `sports ${SIDEBAR_SPORTS.length}`);
  assert.deepEqual(SIDEBAR_SPORTS.slice(0, 4).map((x) => x.league), ['nfl', 'ncaa-football', 'mlb', 'mls']);
});

test('no sidebar panel starts at the very top of the window (under the fixed 64px header)', () => {
  const s = readFileSync('src/components/betting/BettingSidebar.tsx', 'utf8');
  assert.ok(!/fixed right-0 top-0/.test(s));
  assert.ok(s.includes('top-16'));
});

test('the Weatherboards put the sidebar in their reserved column, below the header', () => {
  const s = readFileSync('src/components/layout/WeatherboardLayout.astro', 'utf8');
  assert.ok(s.includes('<BettingSidebarWithProvider client:only="react" inColumn />'));
  assert.ok(s.includes('sticky top-20'));
  assert.ok(s.includes('min-w-0'), 'board column can shrink instead of overflowing under the sidebar');
});
