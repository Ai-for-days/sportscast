import test from 'node:test';
import assert from 'node:assert/strict';
import { WEATHERBOARD_CACHE_CONTROL } from '../src/lib/cache-headers';

// The Weatherboards were served `s-maxage=60, stale-while-revalidate=300`, so
// the edge could hand out a render up to six minutes old. It surfaced as
// "the new WES colors are not being applied" — the page really was showing the
// old ones while the server returned the new ones (X-Vercel-Cache: STALE,
// Age: 164). Colors were the visible symptom; the same window applied to the
// live scores and the game clock, which is the part that matters on a board
// people read during a game.
//
// This pins the ceiling rather than the exact string, so the numbers can be
// tuned without a test edit, but nobody can quietly restore a six-minute one.

function seconds(directive: string): number {
  const m = WEATHERBOARD_CACHE_CONTROL.match(new RegExp(`${directive}=(\\d+)`));
  return m ? Number(m[1]) : 0;
}

test('a board is never more than a minute behind the game it is showing', () => {
  const worstCase = seconds('s-maxage') + seconds('stale-while-revalidate');
  assert.ok(
    worstCase <= 60,
    `the edge can serve a ${worstCase}s-old board; live scores and clock cannot be that stale`,
  );
});

test('the board is still cached — this is a bound, not an opt-out', () => {
  // Zero would be wrong in the other direction: an uncached render costs real
  // upstream work on every view, and a board a few seconds behind is honest.
  assert.ok(seconds('s-maxage') > 0, 'some edge caching must survive');
  assert.match(WEATHERBOARD_CACHE_CONTROL, /public/);
});
