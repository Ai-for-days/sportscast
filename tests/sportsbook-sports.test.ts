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

test('the dropdown offers only sports the odds feed carries, one per league', () => {
  for (const s of SIDEBAR_SPORTS) assert.ok((FEED_LEAGUES as readonly string[]).includes(s.league), s.name);
  assert.equal(new Set(SIDEBAR_SPORTS.map((s) => s.path)).size, SIDEBAR_SPORTS.length);
  assert.deepEqual([...new Set(SIDEBAR_SPORTS.map((s) => s.league))].sort(), [...FEED_LEAGUES].sort());
});
