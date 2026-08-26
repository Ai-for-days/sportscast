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
import { roundHalfPointAvoidingPush, etWallClockHHMM } from '../src/lib/auto-market-shared';

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
