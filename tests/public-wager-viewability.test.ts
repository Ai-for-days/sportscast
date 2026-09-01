import test from 'node:test';
import assert from 'node:assert/strict';
import { isPubliclyVisible, isPubliclyViewable } from '../src/lib/public-wager-view';

// ── Two different questions about one market ──────────────────────────────
//
//   isPubliclyVisible  — may it be browsed and bet on?
//   isPubliclyViewable — may it be SHOWN, read-only?
//
// The second exists because of Derek (2026-08-31): "even if a wager is closed
// on /weatherboard or /weatherboard/extended, it should still be hyperlinked."
// A link has to lead somewhere, so a closed market's page opens instead of
// 404ing.
//
// The boundary from 2026-08-26 — "no one should be able to see expired wagers
// except the admin" — was about the SETTLED book, and these pin that it holds:
// graded and void answer false to both.

const hour = 3600_000;
const future = () => new Date(Date.now() + 3 * hour).toISOString();
const past = () => new Date(Date.now() - 3 * hour).toISOString();

test('an open market before its lock is both bettable and viewable', () => {
  const w = { status: 'open' as const, lockTime: future() };
  assert.equal(isPubliclyVisible(w), true);
  assert.equal(isPubliclyViewable(w), true);
});

test('a locked market is viewable but not bettable', () => {
  // The case the whole change is for: the board shows it greyed and labeled
  // closed, and the link now opens its page.
  const w = { status: 'locked' as const, lockTime: past() };
  assert.equal(isPubliclyVisible(w), false, 'still not bettable');
  assert.equal(isPubliclyViewable(w), true, 'the board links here; it must not 404');
});

test('an open market that drifted past its own lock is viewable, not bettable', () => {
  // The lock cron runs every 30 minutes, so a market can sit `open` with its
  // lock time already passed. Every public surface compares the clock, not
  // just the status.
  const w = { status: 'open' as const, lockTime: past() };
  assert.equal(isPubliclyVisible(w), false);
  assert.equal(isPubliclyViewable(w), true);
});

test('a graded market stays admin-only', () => {
  const w = { status: 'graded' as const, lockTime: past() };
  assert.equal(isPubliclyVisible(w), false);
  assert.equal(isPubliclyViewable(w), false, 'the settled book is not public');
});

test('a void market stays admin-only', () => {
  const w = { status: 'void' as const, lockTime: past() };
  assert.equal(isPubliclyVisible(w), false);
  assert.equal(isPubliclyViewable(w), false);
});

test('viewable is strictly wider than bettable, never narrower', () => {
  // Guards the relationship itself: anything someone may bet on, they may see.
  for (const status of ['open', 'locked', 'graded', 'void'] as const) {
    for (const lockTime of [future(), past()]) {
      const w = { status, lockTime };
      if (isPubliclyVisible(w)) {
        assert.equal(isPubliclyViewable(w), true, `${status} is bettable but not viewable`);
      }
    }
  }
});
