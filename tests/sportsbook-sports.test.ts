// ── Tests: "Place a Bet" sidebar sport list ─────────────────────────────────
//
// Reported by Derek 2026-11-06 (screenshot): the dropdown said "College
// Basketball" while listing NFL games, because the games API fell back to
// NFL for any sport the odds feed does not carry. Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIDEBAR_SPORTS, feedLeagueForSport } from '../src/lib/sportsbook-sports';
import { FEED_LEAGUES } from '../src/lib/odds-feed';

test('a sport the feed does not carry maps to no league, never NFL', () => {
  assert.equal(feedLeagueForSport('basketball/college-basketball'), null);
  assert.equal(feedLeagueForSport('ice-hockey/nhl'), null);
  assert.equal(feedLeagueForSport(''), null);
});

test('each offered sport maps to its own league', () => {
  assert.equal(feedLeagueForSport('football/nfl'), 'nfl');
  assert.equal(feedLeagueForSport('football/college-football'), 'ncaa-football');
  assert.equal(feedLeagueForSport('baseball/mlb'), 'mlb');
  assert.equal(feedLeagueForSport('soccer/north-america/united-states/mls'), 'mls');
});

test('the dropdown lists every sport, and each fed league exactly once', () => {
  // Derek 2026-11-06: "The sidebar should have all sports".
  assert.ok(SIDEBAR_SPORTS.length >= 20, `only ${SIDEBAR_SPORTS.length} sports listed`);
  for (const s of SIDEBAR_SPORTS) {
    if (s.league !== null) assert.ok((FEED_LEAGUES as readonly string[]).includes(s.league), s.name);
  }
  assert.equal(new Set(SIDEBAR_SPORTS.map((s) => s.path)).size, SIDEBAR_SPORTS.length);
  const fed = SIDEBAR_SPORTS.flatMap((s) => (s.league ? [s.league] : []));
  assert.deepEqual([...fed].sort(), [...FEED_LEAGUES].sort());
});

test('sports with odds are listed before sports without', () => {
  const firstUnfed = SIDEBAR_SPORTS.findIndex((s) => s.league === null);
  assert.ok(SIDEBAR_SPORTS.slice(firstUnfed).every((s) => s.league === null));
});
