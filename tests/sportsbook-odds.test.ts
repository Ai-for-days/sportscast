// ── Tests: sportsbook odds matching (NFL preseason support) ────────────
//
// getGameLines merges games across every sport key a league maps to before
// matching — the NFL needs this because The Odds API splits preseason games
// into a separate sport key (`americanfootball_nfl_preseason`) from the
// regular season (`americanfootball_nfl`). Pinned here via the pure
// matchGameLines() matcher so it's testable without touching the network.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGameLines } from '../src/lib/sportsbook-odds';

function oddsGame(overrides: Partial<any> = {}): any {
  return {
    home_team: 'Pittsburgh Steelers',
    away_team: 'New York Jets',
    commence_time: '2026-08-21T23:00:00Z',
    home_rotation: 501,
    away_rotation: 502,
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        last_update: '2026-08-21T20:00:00Z',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'Pittsburgh Steelers', price: -150 }, { name: 'New York Jets', price: 130 }] },
          { key: 'spreads', outcomes: [{ name: 'Pittsburgh Steelers', point: -3, price: -110 }, { name: 'New York Jets', point: 3, price: -110 }] },
          { key: 'totals', outcomes: [{ name: 'Over', point: 36.5, price: -110 }, { name: 'Under', point: 36.5, price: -110 }] },
        ],
      },
    ],
    ...overrides,
  };
}

test('matches a preseason game merged in alongside a regular-season list', () => {
  // Simulates getGameLines('nfl', ...) after merging americanfootball_nfl
  // (regular season, earliest game in September) with
  // americanfootball_nfl_preseason (this game, in August).
  const regularSeasonGames = [oddsGame({
    home_team: 'Seattle Seahawks', away_team: 'New England Patriots', commence_time: '2026-09-10T00:15:00Z',
  })];
  const preseasonGames = [oddsGame()]; // Jets @ Steelers, Aug 21
  const merged = [...regularSeasonGames, ...preseasonGames];

  const lines = matchGameLines(merged, 'Pittsburgh Steelers', 'New York Jets', '2026-08-21T23:00:00Z');
  assert.ok(lines, 'expected a match for the preseason game');
  assert.equal(lines!.bookmaker, 'DraftKings');
  assert.equal(lines!.moneylineHome, -150);
  assert.equal(lines!.moneylineAway, 130);
  assert.equal(lines!.homeRotation, 501);
  assert.equal(lines!.awayRotation, 502);
});

test('returns null when the game is in neither merged list', () => {
  const merged = [oddsGame({ home_team: 'Seattle Seahawks', away_team: 'New England Patriots', commence_time: '2026-09-10T00:15:00Z' })];
  const lines = matchGameLines(merged, 'Pittsburgh Steelers', 'New York Jets', '2026-08-21T23:00:00Z');
  assert.equal(lines, null);
});

test('30-minute kickoff tolerance still applies within the merged list', () => {
  const merged = [oddsGame({ commence_time: '2026-08-21T23:20:00Z' })]; // 20 min off
  const lines = matchGameLines(merged, 'Pittsburgh Steelers', 'New York Jets', '2026-08-21T23:00:00Z');
  assert.ok(lines, 'expected a match within the 30-minute tolerance');
});

test('team names outside the 30-minute tolerance do not match across the merge', () => {
  const merged = [oddsGame({ commence_time: '2026-08-21T23:45:00Z' })]; // 45 min off
  const lines = matchGameLines(merged, 'Pittsburgh Steelers', 'New York Jets', '2026-08-21T23:00:00Z');
  assert.equal(lines, null);
});

test('drops bad (non-3-digit) rotation numbers even in a merged preseason match', () => {
  const merged = [oddsGame({ home_rotation: 15000, away_rotation: 502 })];
  const lines = matchGameLines(merged, 'Pittsburgh Steelers', 'New York Jets', '2026-08-21T23:00:00Z');
  assert.ok(lines);
  assert.equal(lines!.homeRotation, null);
  assert.equal(lines!.awayRotation, 502);
});
