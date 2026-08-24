// ── Tests: automated "Wager on Weather - HvL" spread rounding ──────────────
//
// Added 2026-08-23 per Derek's answer to the rounding-direction question:
// odds are always fixed -110/-110, and the mandatory .5 always favors the
// Low ("dog") side — the High side must beat the raw forecast gap by MORE
// to win, never less. Pure function, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundHalfPointFavoringDog } from '../src/lib/auto-hvl-market';

test('a whole-number raw diff gets bumped up by exactly .5', () => {
  assert.equal(roundHalfPointFavoringDog(14), 14.5);
  assert.equal(roundHalfPointFavoringDog(0), 0.5);
  assert.equal(roundHalfPointFavoringDog(1), 1.5);
});

test('a raw diff already ending in .5 is left unchanged', () => {
  assert.equal(roundHalfPointFavoringDog(14.5), 14.5);
  assert.equal(roundHalfPointFavoringDog(0.5), 0.5);
});

test('a fractional raw diff always rounds UP to the next half-point, never down', () => {
  assert.equal(roundHalfPointFavoringDog(14.1), 14.5);
  assert.equal(roundHalfPointFavoringDog(14.4), 14.5);
});

test('a fractional raw diff that would round to a whole half-point gets bumped further', () => {
  // 14.6 rounds up to the 15.0 grid point, which is itself a push risk — bump to 15.5.
  assert.equal(roundHalfPointFavoringDog(14.6), 15.5);
});

test('the result never favors the High side relative to the raw diff', () => {
  for (const raw of [0, 0.2, 3.9, 10, 22.5, 40]) {
    assert.ok(roundHalfPointFavoringDog(raw) >= raw, `magnitude for raw=${raw} must be >= raw diff`);
  }
});
