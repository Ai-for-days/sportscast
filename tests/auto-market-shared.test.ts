// ── Tests: shared utilities for the automated market-creation engines ──────
//
// Covers the pure helpers extracted 2026-08-25 when Degrees HvH, Degrees
// LvL, and the per-venue "Temp at Game Start" O/U were added alongside the
// original HvL engine (auto-hvl-market.ts). roundHalfPointFavoringDog's own
// behavior was already covered indirectly by the HvL engine's prior tests;
// this file focuses on the two pieces new to this change:
// roundHalfPointAvoidingPush (the O/U line convention) and etWallClockHHMM
// (the "same UTC instant, ET wall-clock label" convention for by-time
// auto-markets, see auto-market-shared.ts's doc comment for the full
// reasoning, confirmed live with Derek 2026-08-25).
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundHalfPointAvoidingPush, etWallClockHHMM, lockTimeBeforeKickoff } from '../src/lib/auto-market-shared';

test('roundHalfPointAvoidingPush rounds a whole-degree forecast up to a .5 line', () => {
  assert.equal(roundHalfPointAvoidingPush(82), 82.5);
});

test('roundHalfPointAvoidingPush leaves an already-fractional forecast on the nearest .5', () => {
  assert.equal(roundHalfPointAvoidingPush(82.3), 82.5);
  assert.equal(roundHalfPointAvoidingPush(82.7), 82.5);
  assert.equal(roundHalfPointAvoidingPush(82.76), 83.5);
});

test('roundHalfPointAvoidingPush never returns a whole number', () => {
  for (const raw of [0, 1, 50, 99.5, 100, -5]) {
    const line = roundHalfPointAvoidingPush(raw);
    assert.notEqual(Number.isInteger(line), true, `${raw} -> ${line} should not be a whole number`);
  }
});

test('etWallClockHHMM converts a UTC kickoff instant to its ET wall-clock time (EDT, summer)', () => {
  // 2026-08-28 is in Eastern Daylight Time (UTC-4).
  assert.equal(etWallClockHHMM('2026-08-28T23:05:00.000Z'), '19:05');
  assert.equal(etWallClockHHMM('2026-08-28T17:10:00.000Z'), '13:10');
});

test('etWallClockHHMM converts correctly across the UTC midnight boundary', () => {
  // 03:30 UTC on 08-29 is 23:30 ET on 08-28 (still EDT).
  assert.equal(etWallClockHHMM('2026-08-29T03:30:00.000Z'), '23:30');
});

test('etWallClockHHMM handles standard time (EST, winter, UTC-5)', () => {
  assert.equal(etWallClockHHMM('2026-01-15T20:00:00.000Z'), '15:00');
});

// Superseded 2026-08-27: this 3-hour rule now applies ONLY to markets that
// do not measure a daily high or low. Daily ones lock at 6 AM local at the
// venue instead, covered in tests/wager-lock-rule.test.ts. The two tests
// below still stand as the contract for lockTimeBeforeKickoff itself, which
// is now the venue O/U engine's rule rather than everyone's.
test('lockTimeBeforeKickoff locks exactly 3 hours before the kickoff instant', () => {
  assert.equal(lockTimeBeforeKickoff('2026-08-26T23:05:00.000Z'), '2026-08-26T20:05:00.000Z');
});

test('lockTimeBeforeKickoff handles a kickoff early enough that the lock falls on the previous UTC day', () => {
  assert.equal(lockTimeBeforeKickoff('2026-08-26T01:00:00.000Z'), '2026-08-25T22:00:00.000Z');
});

// ── Game identity for the auto-market pointers ───────────────────────────
//
// Found 2026-09-08 on the live 2026-09-09 slate: duplicate OPEN pointspreads
// on one event, e.g. Gillette/T-Mobile High vs High listed at both +2.5 and
// -3.5, created five days apart. The engines keyed their "already made a
// market for this game" pointer on the feed's own game id, and that id is not
// stable — ESPN gives a numeric event id, the Odds API fallback gives
// `odds-<pair>-<ms>`. ESPN's host started 403ing on 2026-08-29, every game
// arrived under the fallback id, the pointer missed, and a second market was
// minted at whatever the forecast said that day.
import { autoMarketGameKey } from '../src/lib/auto-market-shared';

const gillette = { id: 'gillette-stadium', name: 'Gillette Stadium' } as any;

test('the same game under two different feed ids gets one key', () => {
  const espn = { id: '401858423', venue: gillette, kickoffUTC: '2026-09-09T17:00:00Z' };
  const odds = { id: 'odds-patriots|dolphins-1789000000000', venue: gillette, kickoffUTC: '2026-09-09T17:00:00Z' };
  assert.equal(autoMarketGameKey(espn), autoMarketGameKey(odds));
  assert.notEqual(autoMarketGameKey(espn), espn.id);
});

test('two games at one venue on the same day stay separate', () => {
  // A doubleheader is genuinely two games and must not share one market
  // pointer, which is why the key is the kickoff hour and not the date.
  const early = { id: 'a', venue: gillette, kickoffUTC: '2026-09-09T17:00:00Z' };
  const late = { id: 'b', venue: gillette, kickoffUTC: '2026-09-09T23:00:00Z' };
  assert.notEqual(autoMarketGameKey(early), autoMarketGameKey(late));
});

test('an unusable venue or kickoff falls back to the feed id', () => {
  // Never return an empty or colliding key: worst case we behave exactly as
  // the code did before this change for that one game.
  assert.equal(autoMarketGameKey({ id: 'x1', venue: null, kickoffUTC: '2026-09-09T17:00:00Z' }), 'x1');
  assert.equal(autoMarketGameKey({ id: 'x2', venue: gillette, kickoffUTC: 'not a date' }), 'x2');
});
