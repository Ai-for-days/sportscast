// ── Tests: the public visibility gate ──────────────────────────────────────
//
// Per Derek (2026-08-26): "no one should be able to see expired wagers except
// the admin." isPubliclyVisible() is the single predicate every public surface
// runs through (the markets page, /api/wagers, /wagers/{id}, the per-game
// page, and the Weatherboard's native-market lookup), so it is worth pinning
// down precisely. If someone widens it, one of these should fail.
//
// Run with `npm test`. No network, no Redis.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPubliclyVisible } from '../src/lib/public-wager-view';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

test('an open market that has not reached its lock time is public', () => {
  assert.equal(isPubliclyVisible({ status: 'open', lockTime: FUTURE }), true);
});

test('an open market past its own lock time is not public', () => {
  // This is the drift case: a lock cron has not caught up yet, so the record
  // still says open even though it stopped accepting action.
  assert.equal(isPubliclyVisible({ status: 'open', lockTime: PAST }), false);
});

test('a locked market is never public, even with a future lock time on the record', () => {
  assert.equal(isPubliclyVisible({ status: 'locked', lockTime: FUTURE }), false);
  assert.equal(isPubliclyVisible({ status: 'locked', lockTime: PAST }), false);
});

test('a graded market is never public', () => {
  // Settled results used to render in a public "Resolved markets" section.
  // They are admin-only now. A customer still sees the outcome of a market
  // they personally bet on, but through /api/bets, not through browsing.
  assert.equal(isPubliclyVisible({ status: 'graded', lockTime: PAST }), false);
});

test('a voided market is never public', () => {
  assert.equal(isPubliclyVisible({ status: 'void', lockTime: PAST }), false);
});

test('an unparseable lock time fails closed rather than open', () => {
  assert.equal(isPubliclyVisible({ status: 'open', lockTime: 'not-a-date' }), false);
  assert.equal(isPubliclyVisible({ status: 'open', lockTime: '' }), false);
});
