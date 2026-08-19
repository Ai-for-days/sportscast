// ── Tests: wind-relative-to-field direction ────────────────────────────
//
// Pins the "which way is the wind blowing on the field" math independent of
// a stadium's real-world compass orientation. Get the +180 (from->toward)
// or the rotation-into-diamond-frame backwards and every stadium's arrow
// points the wrong way while still looking plausible.
//
// Run with `npm test`. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windArrowRotationDeg, fieldWindSector, fieldWindLabel } from '../src/lib/stadium-wind';

test('a south wind at a north-facing park blows OUT to center', () => {
  // Stadium faces due north (CF bearing 0). Wind FROM the south (180) blows
  // from home plate toward center field — i.e. out to center.
  const rotation = windArrowRotationDeg(180, 0);
  assert.equal(rotation, 0);
  assert.equal(fieldWindSector(rotation), 'center');
  assert.equal(fieldWindLabel(180, 0), 'Blowing out to center');
});

test('a north wind at a north-facing park blows IN from center', () => {
  const rotation = windArrowRotationDeg(0, 0);
  assert.equal(rotation, 180);
  assert.equal(fieldWindSector(rotation), 'in-center');
});

test('the arrow rotation is relative to the stadium\'s own orientation, not true north', () => {
  // A stadium facing due EAST (CF bearing 90). A wind FROM the west (270)
  // blows toward the east, i.e. still straight out to center for THIS park.
  const rotation = windArrowRotationDeg(270, 90);
  assert.equal(rotation, 0);
  assert.equal(fieldWindSector(rotation), 'center');
});

test('a pure crosswind blows toward the right-field line, not out or in', () => {
  // Stadium faces north (CF=0). Wind FROM the west (270) blows toward the
  // east — a pure left-to-right crosswind relative to the diamond.
  const rotation = windArrowRotationDeg(270, 0);
  assert.equal(rotation, 90);
  assert.equal(fieldWindSector(rotation), 'right');
});

test('sector buckets wrap cleanly at the 0/360 boundary', () => {
  assert.equal(fieldWindSector(359), 'center');
  assert.equal(fieldWindSector(0), 'center');
  assert.equal(fieldWindSector(1), 'center');
});
